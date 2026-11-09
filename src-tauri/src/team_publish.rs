use std::{str::FromStr, time::Duration};

use bytes::Bytes;
use tauri::ipc::{Channel, InvokeBody, JavaScriptChannelId, Request};
use tauri_plugin_http::reqwest::{self, header, redirect, Body, Client};
use url::{Host, Url};

const REQUEST_LIMIT: usize = 416 * 1024 * 1024;
const RESPONSE_LIMIT: usize = 1024 * 1024;
const UPLOAD_CHUNK_SIZE: usize = 64 * 1024;
const ORIGIN_ERROR: &str = "请输入 HTTPS 服务根地址（本机测试可用 HTTP localhost）";
const AMBIGUOUS_RESULT: &str = "服务器可能已完成发布；请先检查团队库，确需重试时请手动使用同一发布标识重试，避免重复发布。";

#[derive(Debug, serde::Serialize)]
pub(crate) struct NativePublishResponse {
    status: u16,
    body: String,
}

#[derive(Clone, Debug, serde::Serialize)]
struct PublishProgress {
    phase: &'static str,
    loaded: usize,
    total: usize,
}

fn trusted_window(label: &str, url: &Url, development: bool) -> bool {
    if label != "main" || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    match (url.scheme(), url.host_str(), url.port()) {
        ("tauri", Some("localhost"), None) => true,
        ("http" | "https", Some("tauri.localhost"), None) => true,
        ("http", Some("localhost"), Some(1420)) if development => true,
        _ => false,
    }
}

fn publish_url(origin: &str) -> Result<Url, String> {
    let mut url = Url::parse(origin).map_err(|_| ORIGIN_ERROR.to_string())?;
    let loopback = match url.host() {
        Some(Host::Domain("localhost")) => true,
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        _ => false,
    };
    if url.host().is_none()
        || !(url.scheme() == "https" || (url.scheme() == "http" && loopback))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(ORIGIN_ERROR.into());
    }
    // Only the canonical origin (optionally its root slash) is accepted. Reject
    // normalized-away credentials, dot paths, backslashes and whitespace as well.
    let canonical = url.origin().ascii_serialization();
    if origin != canonical && origin.strip_suffix('/') != Some(canonical.as_str()) {
        return Err(ORIGIN_ERROR.into());
    }
    url.set_path("/api/team/publish");
    Ok(url)
}

fn authorization(token: &str) -> Result<header::HeaderValue, String> {
    if token.is_empty() || token.len() > 4096 || token.bytes().any(|byte| !byte.is_ascii_graphic()) {
        return Err("团队登录凭据无效，请重新登录".into());
    }
    let mut value = header::HeaderValue::from_str(&format!("Bearer {token}"))
        .map_err(|_| "团队登录凭据无效，请重新登录".to_string())?;
    value.set_sensitive(true);
    Ok(value)
}

fn validate_body(body: &[u8]) -> Result<(), String> {
    if body.len() > REQUEST_LIMIT {
        return Err("团队发布内容超过 416 MiB 限制".into());
    }
    let json_space = |byte: &u8| matches!(*byte, b' ' | b'\t' | b'\n' | b'\r');
    let start = body.iter().position(|byte| !json_space(byte));
    let end = body.iter().rposition(|byte| !json_space(byte));
    let (Some(start), Some(end)) = (start, end) else {
        return Err("团队发布内容必须是非空 JSON 对象".into());
    };
    // The caller already serialized TeamPublish. Check the object envelope only;
    // semantic JSON validation belongs to the publish service, without building
    // another potentially 416 MiB object tree in the desktop process.
    if body[start] != b'{' || body[end] != b'}' || start >= end {
        return Err("团队发布内容必须是非空 JSON 对象".into());
    }
    if body[start + 1..end].iter().find(|byte| !json_space(byte)) != Some(&b'"') {
        return Err("团队发布内容必须是非空 JSON 对象".into());
    }
    Ok(())
}

fn transport_error(error: &reqwest::Error) -> String {
    // Never format the source error: it can include URLs or proxy credentials.
    if error.is_timeout() {
        format!("团队发布请求超时（连接限时 15 秒，整个请求限时 900 秒）。{AMBIGUOUS_RESULT}")
    } else if error.is_connect() {
        "无法连接团队服务，请检查网络、代理及服务地址后手动重试。".into()
    } else {
        format!("团队发布网络传输失败。{AMBIGUOUS_RESULT}")
    }
}

fn upload_stream(
    body: Bytes,
    progress: Option<Channel<PublishProgress>>,
) -> impl futures_util::Stream<Item = Result<Bytes, std::io::Error>> + Send + 'static {
    let total = body.len();
    // Report consumed HTTP-body bytes, not a claim of server acknowledgement.
    // A single owned IPC-buffer copy backs every zero-copy Bytes slice.
    futures_util::stream::unfold((body, 0, progress), move |(body, loaded, progress)| async move {
        if loaded == 0 {
            if let Some(channel) = &progress {
                let _ = channel.send(PublishProgress { phase: "uploading", loaded: 0, total });
            }
        }
        if loaded == total {
            return None;
        }
        let end = (loaded + UPLOAD_CHUNK_SIZE).min(total);
        let chunk = body.slice(loaded..end);
        if let Some(channel) = &progress {
            let _ = channel.send(PublishProgress {
                phase: if end == total { "processing" } else { "uploading" },
                loaded: end,
                total,
            });
        }
        Some((Ok::<Bytes, std::io::Error>(chunk), (body, end, progress)))
    })
}

async fn publish_bytes(
    origin: &str,
    token: &str,
    body: &[u8],
    progress: Option<Channel<PublishProgress>>,
) -> Result<NativePublishResponse, String> {
    let endpoint = publish_url(origin)?;
    let authorization = authorization(token)?;
    validate_body(body)?;
    let client = Client::builder()
        .redirect(redirect::Policy::none())
        .retry(reqwest::retry::never())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(900))
        .build()
        .map_err(|_| "无法初始化团队发布网络客户端，请检查系统网络和代理配置".to_string())?;
    let mut response = client.post(endpoint)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CONTENT_LENGTH, body.len())
        .header(header::AUTHORIZATION, authorization)
        .body(Body::wrap_stream(upload_stream(Bytes::copy_from_slice(body), progress)))
        .send().await.map_err(|error| transport_error(&error))?;
    let status = response.status().as_u16();
    let response_limit_error = || format!("团队发布响应超过 1 MiB 限制。{AMBIGUOUS_RESULT}");
    if response.content_length().is_some_and(|length| length > RESPONSE_LIMIT as u64) {
        return Err(response_limit_error());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| transport_error(&error))? {
        if chunk.len() > RESPONSE_LIMIT - bytes.len() {
            return Err(response_limit_error());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8(bytes)
        .map_err(|_| format!("团队发布响应不是有效 UTF-8。{AMBIGUOUS_RESULT}"))?;
    Ok(NativePublishResponse { status, body })
}

#[tauri::command]
pub(crate) async fn desktop_team_publish(
    window: tauri::WebviewWindow,
    request: Request<'_>,
) -> Result<NativePublishResponse, String> {
    let url = window.url().map_err(|_| "无法确认团队发布调用来源".to_string())?;
    if !trusted_window(window.label(), &url, cfg!(debug_assertions)) {
        return Err("团队发布仅允许本地主窗口调用".into());
    }
    let origin = request.headers().get("x-team-origin")
        .and_then(|value| value.to_str().ok()).ok_or("缺少团队服务地址")?;
    let token = request.headers().get("x-team-token")
        .and_then(|value| value.to_str().ok()).ok_or("缺少团队登录凭据")?;
    let progress = request.headers().get("x-team-progress").map(|value| {
        let id = value.to_str().ok()
            .and_then(|value| JavaScriptChannelId::from_str(value).ok())
            .ok_or("团队发布进度通道无效")?;
        Ok::<_, &str>(id.channel_on(window.as_ref().clone()))
    }).transpose()?;
    let InvokeBody::Raw(body) = request.body() else {
        return Err("团队发布内容必须使用原始字节传输".into());
    };
    publish_bytes(origin, token, body, progress).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::{Arc, Mutex};

    #[test]
    fn publish_endpoint_accepts_only_exact_secure_or_loopback_origins() {
        for origin in ["https://portal.example", "https://portal.example/", "https://portal.example:8443", "http://localhost:1421", "http://127.0.0.1:38008", "http://[::1]:8080"] {
            let endpoint = publish_url(origin).unwrap();
            assert_eq!(endpoint.path(), "/api/team/publish");
            assert!(endpoint.query().is_none() && endpoint.fragment().is_none());
        }
        for origin in ["http://portal.example", "http://192.168.1.1:8080", "http://localhost.evil", "https://user:secret@portal.example", "https://@portal.example", "https://portal.example/api/team/publish", "https://portal.example/a/..", "https://portal.example?", "https://portal.example#", "https://portal.example/\\evil", " https://portal.example", "https://portal.example\n", "file:///tmp/team.json", "tauri://localhost", "not a URL"] {
            assert_eq!(publish_url(origin).unwrap_err(), ORIGIN_ERROR, "{origin}");
        }
    }

    #[test]
    fn only_local_main_window_is_trusted() {
        for origin in ["tauri://localhost/index.html", "http://tauri.localhost/", "https://tauri.localhost/"] {
            assert!(trusted_window("main", &Url::parse(origin).unwrap(), false));
            assert!(!trusted_window("oauth", &Url::parse(origin).unwrap(), true));
        }
        for origin in ["https://portal.example", "https://tauri.localhost.evil", "http://tauri.localhost:1420", "tauri://user@localhost/", "http://localhost:1420", "http://127.0.0.1:1420"] {
            assert!(!trusted_window("main", &Url::parse(origin).unwrap(), false));
        }
        assert!(trusted_window("main", &Url::parse("http://localhost:1420").unwrap(), true));
        assert!(!trusted_window("main", &Url::parse("http://localhost:1421").unwrap(), true));
    }

    #[test]
    fn payload_and_authorization_boundaries_do_not_echo_secrets() {
        for token in ["", "secret\r\nX-Evil: yes", "secret token", "秘密"] {
            let error = authorization(token).unwrap_err();
            assert_eq!(error, "团队登录凭据无效，请重新登录");
        }
        assert!(authorization(&"a".repeat(4096)).is_ok());
        assert!(authorization(&"a".repeat(4097)).is_err());
        let value = authorization("secret").unwrap();
        assert!(value.is_sensitive());
        assert_eq!(value.to_str().unwrap(), "Bearer secret");
        for body in [b"".as_slice(), b" \r\n\t", b"{}", b"{ }", b"[]", b"null", b"{broken}", b"{\"key\":1} trailing"] {
            assert!(validate_body(body).is_err());
        }
        assert!(validate_body(b" \n{\"key\":\"test\",\"payload\":{}}\t").is_ok());
        assert_eq!(REQUEST_LIMIT, 416 * 1024 * 1024);
        // Allocate the overflow byte up front instead of doubling a full buffer on push.
        let mut body = vec![b' '; REQUEST_LIMIT + 1];
        body[..6].copy_from_slice(b"{\"x\":1");
        body[REQUEST_LIMIT - 1] = b'}';
        assert!(validate_body(&body[..REQUEST_LIMIT]).is_ok());
        assert!(validate_body(&body).unwrap_err().contains("416 MiB"));
    }

    #[test]
    fn request_error_text_never_exposes_url_or_credentials() {
        let error = Client::new()
            .post("https://secret-user:secret-pass@example.invalid/private-secret")
            .header(header::AUTHORIZATION, "Bearer secret-token\r\nInjected: yes")
            .build().unwrap_err();
        let message = transport_error(&error);
        assert_eq!(message, format!("团队发布网络传输失败。{AMBIGUOUS_RESULT}"));
        assert!(!message.contains("secret"));
        assert!(!message.contains("example.invalid"));
    }

    #[test]
    fn timeout_error_explains_commit_ambiguity_and_manual_same_identifier_retry() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            std::thread::sleep(Duration::from_millis(100));
            drop(stream);
        });
        let error = tauri::async_runtime::block_on(async {
            Client::builder().no_proxy().timeout(Duration::from_millis(20))
                .build().unwrap().get(origin).send().await.unwrap_err()
        });
        server.join().unwrap();
        assert!(error.is_timeout());
        let message = transport_error(&error);
        assert!(message.contains("超时"));
        assert!(message.contains("连接限时 15 秒"));
        assert!(message.contains("整个请求限时 900 秒"));
        assert!(message.contains("服务器可能已完成发布"));
        assert!(message.contains("手动使用同一发布标识重试"));
        assert!(!message.contains("127.0.0.1"));
    }

    fn receive_request(stream: &mut TcpStream) -> (String, Vec<u8>) {
        stream.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
        let mut received = Vec::new();
        let mut buffer = [0_u8; 16 * 1024];
        let header_end = loop {
            let length = stream.read(&mut buffer).unwrap();
            assert_ne!(length, 0, "request ended before its headers");
            received.extend_from_slice(&buffer[..length]);
            if let Some(position) = received.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                break position + 4;
            }
        };
        let headers = String::from_utf8(received[..header_end].to_vec()).unwrap();
        let length: usize = headers.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length").then(|| value.trim().parse().unwrap())
        }).expect("explicit Content-Length header");
        let mut body = received.split_off(header_end);
        while body.len() < length {
            let count = stream.read(&mut buffer).unwrap();
            assert_ne!(count, 0, "request ended before its body");
            body.extend_from_slice(&buffer[..count]);
        }
        assert_eq!(body.len(), length);
        (headers, body)
    }

    fn local_response(response: Vec<u8>) -> Result<NativePublishResponse, String> {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            receive_request(&mut stream);
            let _ = stream.write_all(&response);
        });
        let result = tauri::async_runtime::block_on(publish_bytes(
            &origin, "local-test-token", b"{\"key\":\"response-test\"}", None,
        ));
        server.join().unwrap();
        result
    }

    #[test]
    #[ignore = "uses only ephemeral local HTTP receivers to check native response boundaries"]
    fn live_local_preserves_error_and_redirect_status_and_caps_response_chunks() {
        for (status, extra, body) in [
            (401, "", r#"{"error":"login expired"}"#),
            (409, "", r#"{"error":"version conflict"}"#),
            (307, "Location: https://must-not-contact.invalid/\r\n", "redirect not followed"),
        ] {
            let response = format!("HTTP/1.1 {status} Test\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            let result = local_response(response.into_bytes()).unwrap();
            assert_eq!(result.status, status);
            assert_eq!(result.body, body);
        }
        let error = local_response(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", RESPONSE_LIMIT + 1).into_bytes()).unwrap_err();
        assert!(error.contains("1 MiB"));
        let mut response = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n".to_vec();
        for _ in 0..=RESPONSE_LIMIT / UPLOAD_CHUNK_SIZE {
            response.extend_from_slice(format!("{UPLOAD_CHUNK_SIZE:x}\r\n").as_bytes());
            response.resize(response.len() + UPLOAD_CHUNK_SIZE, b'x');
            response.extend_from_slice(b"\r\n");
        }
        response.extend_from_slice(b"0\r\n\r\n");
        let error = local_response(response).unwrap_err();
        assert!(error.contains("1 MiB"));
        assert!(error.contains("服务器可能已完成发布"));
    }

    #[test]
    fn upload_stream_reports_consumed_bytes_and_processing_without_copying_chunks() {
        let progress = Arc::new(Mutex::new(Vec::new()));
        let captured = progress.clone();
        let channel = Channel::new(move |message| {
            let tauri::ipc::InvokeResponseBody::Json(json) = message else { panic!("expected progress JSON"); };
            captured.lock().unwrap().push(serde_json::from_str::<serde_json::Value>(&json).unwrap());
            Ok(())
        });
        let body = Bytes::from(vec![b'x'; UPLOAD_CHUNK_SIZE * 2 + 7]);
        let total = body.len();
        let pointer = body.as_ptr() as usize;
        tauri::async_runtime::block_on(async {
            use futures_util::StreamExt;
            let stream = upload_stream(body, Some(channel));
            futures_util::pin_mut!(stream);
            let mut loaded = 0;
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.unwrap();
                assert_eq!(chunk.as_ptr() as usize, pointer + loaded);
                assert!(chunk.len() <= UPLOAD_CHUNK_SIZE);
                loaded += chunk.len();
            }
            assert_eq!(loaded, total);
        });
        let progress = progress.lock().unwrap();
        assert_eq!(progress.len(), 4);
        assert_eq!(progress[0]["phase"], "uploading");
        assert_eq!(progress[0]["loaded"], 0);
        assert_eq!(progress[1]["loaded"], UPLOAD_CHUNK_SIZE);
        assert_eq!(progress[2]["loaded"], UPLOAD_CHUNK_SIZE * 2);
        assert_eq!(progress[3]["phase"], "processing");
        assert_eq!(progress[3]["loaded"], total);
        assert!(progress.iter().all(|event| event["total"] == total));
    }

    #[test]
    #[ignore = "starts only a local raw HTTP receiver; sends a 10 MiB publish body"]
    fn live_local_publish_preserves_bytes_auth_response_and_upload_progress() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let mut body = b"{\"key\":\"native-byte-test\",\"payload\":\"".to_vec();
        body.resize(body.len() + 10 * 1024 * 1024, b'x');
        body.extend_from_slice(b"\"}");
        let expected = body.clone();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let (headers, received) = receive_request(&mut stream);
            assert!(headers.starts_with("POST /api/team/publish HTTP/1.1\r\n"));
            assert!(headers.to_ascii_lowercase().contains("authorization: bearer local-test-token\r\n"));
            assert!(headers.to_ascii_lowercase().contains("content-type: application/json\r\n"));
            assert!(!headers.to_ascii_lowercase().contains("x-team-"));
            assert_eq!(received, expected);
            let response = r#"{"id":"native-byte-test","version":1}"#;
            write!(stream, "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response).unwrap();
        });
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = events.clone();
        let channel = Channel::new(move |message| {
            let tauri::ipc::InvokeResponseBody::Json(json) = message else { panic!("expected JSON progress"); };
            captured.lock().unwrap().push(serde_json::from_str::<serde_json::Value>(&json).unwrap());
            Ok(())
        });
        let response = tauri::async_runtime::block_on(publish_bytes(&origin, "local-test-token", &body, Some(channel))).unwrap();
        server.join().unwrap();
        assert_eq!(response.status, 201);
        assert_eq!(response.body, r#"{"id":"native-byte-test","version":1}"#);
        let events = events.lock().unwrap();
        assert_eq!(events.first().unwrap()["loaded"], 0);
        assert_eq!(events.last().unwrap()["phase"], "processing");
        assert_eq!(events.last().unwrap()["loaded"], body.len());
        assert!(events.iter().all(|event| event["total"] == body.len()));
        assert!(events.windows(2).all(|pair| pair[0]["loaded"].as_u64().unwrap() < pair[1]["loaded"].as_u64().unwrap()));
    }
}
