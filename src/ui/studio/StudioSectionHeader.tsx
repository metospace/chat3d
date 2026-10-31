import type {ReactNode} from 'react';
import {Tag} from 'antd';

export function StudioSectionHeader({
  id,
  title,
  count,
  actions,
  level = 2,
}: {
  id?: string;
  title: string;
  count?: number;
  actions?: ReactNode;
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <header className="studio-section-header home-panel-heading">
      <Heading id={id} className="studio-section-title">
        {title}
        {count !== undefined && (
          <Tag variant="filled" className="studio-section-count">
            {count}
          </Tag>
        )}
      </Heading>
      {actions}
    </header>
  );
}
