export interface GenerationProgress {
  phase: 'waiting' | 'receiving' | 'correcting' | 'validating';
  attempt: number;
  characters: number;
  lastEventAt: number;
  streaming: boolean;
}

// Only expose transport facts. Never display reasoning or incomplete JSON as the final answer.
export async function readChatResponse(res: Response, signal: AbortSignal | undefined,
  update: (characters: number, streaming: boolean) => void,onDiagnostic?: (kind:string,data:unknown)=>void): Promise<string> {
  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    update(0, false);
    const data = await res.json();
    onDiagnostic?.('model_response',data);
    if (signal?.aborted) throw new DOMException('已停止', 'AbortError');
    if (data?.choices?.[0]?.finish_reason === 'length') throw new Error('模型输出达到长度上限，请拆分为较小的建模步骤');
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('接口未返回最终答案，请使用支持输出最终答案的模型');
    update(content.length, false);
    return content;
  }
  update(0, true);
  if (!res.body) throw new Error('接口未返回可读取的响应流');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', answer = '', done = false, finished = false, bytes = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  const consume = (event: string) => {
    const data = event.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n').trim();
    if (!data) return;
    if (data === '[DONE]') { done = true; return; }
    let chunk;
    try { chunk = JSON.parse(data); } catch { throw new Error('服务返回了损坏的流式数据，请重试'); }
    onDiagnostic?.('provider_event',chunk);
    if (chunk.error) throw new Error('模型服务在生成过程中返回错误，请检查服务日志或稍后重试');
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error('模型输出达到长度上限，请分步创建主体和细节');
    if (choice?.finish_reason === 'content_filter') throw new Error('模型服务未能完成本次输出');
    if (choice?.finish_reason) finished = true;
    if (typeof choice?.delta?.content === 'string') answer += choice.delta.content;
    update(answer.length, true);
  };
  try {
    while (!done) {
      if (signal?.aborted) throw new DOMException('已停止', 'AbortError');
      const part = await reader.read();
      if (signal?.aborted) throw new DOMException('已停止', 'AbortError');
      bytes += part.value?.byteLength ?? 0;
      if (bytes > 2 * 1024 * 1024) throw new Error('本次响应过大，请拆分建模任务');
      buffer += decoder.decode(part.value, { stream: !part.done });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        consume(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2);
        if (done) break;
      }
      if (part.done) { if (buffer.trim()) consume(buffer); break; }
    }
    if (!done && !finished) throw new Error('响应传输中断，未收到结束标记；场景未修改，可重试');
    if (!answer.trim()) throw new Error('接口没有返回最终答案内容');
    return answer;
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
