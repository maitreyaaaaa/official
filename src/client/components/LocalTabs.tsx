import type { KeyboardEvent } from 'react';

export interface LocalTab<T extends string> {
  id: T;
  label: string;
  count?: number | string;
}

interface LocalTabsProps<T extends string> {
  label: string;
  idPrefix: string;
  tabs: LocalTab<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function LocalTabs<T extends string>({ label, idPrefix, tabs, value, onChange }: LocalTabsProps<T>) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex((tab) => tab.id === value);
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const target = tabs[next];
    onChange(target.id);
    window.requestAnimationFrame(() => document.getElementById(`${idPrefix}-tab-${target.id}`)?.focus());
  };

  return <div className="local-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
    {tabs.map((tab) => <button key={tab.id} type="button" role="tab" id={`${idPrefix}-tab-${tab.id}`} aria-selected={value === tab.id} aria-controls={`${idPrefix}-panel-${tab.id}`} tabIndex={value === tab.id ? 0 : -1} onClick={() => onChange(tab.id)}>{tab.label}{tab.count !== undefined && <span>{tab.count}</span>}</button>)}
  </div>;
}
