import type {ReactNode} from 'react';
import {PageHeader} from '@ant-design/pro-components';
export interface StudioPageHeaderProps {eyebrow?:string;title:string;description?:string;icon?:ReactNode;actions?:ReactNode}
export function StudioPageHeader({title,description,actions}:StudioPageHeaderProps){return <PageHeader className="pro-studio-page-header" title={<h1>{title}</h1>} extra={actions}>{description}</PageHeader>;}
