import fs from 'fs';
import path from 'path';
import type { Source, Item } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');

function readJson<T>(filename: string): T {
  const filePath = path.join(DATA_DIR, filename);
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function writeJson<T>(filename: string, data: T): void {
  const filePath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ---- Sources ----

export function getSources(): Source[] {
  return readJson<Source[]>('sources.json');
}

// ---- Items ----

export function getItems(): Item[] {
  const items = readJson<Item[]>('items.json');
  // 按发布时间倒序
  return items.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

export function getSelectedItems(): Item[] {
  return getItems().filter((item) => item.isSelected);
}

export function getItemsByTag(tag: string): Item[] {
  const items = getSelectedItems();
  if (!tag || tag === 'all') return items;
  return items.filter((item) => item.score?.tags?.includes(tag));
}

export function searchItems(query: string): Item[] {
  const items = getSelectedItems();
  if (!query) return items;
  const q = query.toLowerCase();
  return items.filter(
    (item) =>
      item.titleZh.toLowerCase().includes(q) ||
      item.summaryZh.toLowerCase().includes(q) ||
      item.title.toLowerCase().includes(q) ||
      item.sourceName.toLowerCase().includes(q)
  );
}

// ---- All items (including non-selected) ----

export function getAllItemsByTag(tag: string): Item[] {
  const items = getItems();
  if (!tag || tag === 'all') return items;
  return items.filter((item) => item.score?.tags?.includes(tag));
}

export function searchAllItems(query: string): Item[] {
  const items = getItems();
  if (!query) return items;
  const q = query.toLowerCase();
  return items.filter(
    (item) =>
      item.titleZh.toLowerCase().includes(q) ||
      item.summaryZh.toLowerCase().includes(q) ||
      item.title.toLowerCase().includes(q) ||
      item.sourceName.toLowerCase().includes(q)
  );
}

export function getAllTags(): string[] {
  const items = getSelectedItems();
  const tagSet = new Set<string>();
  items.forEach((item) => {
    item.score?.tags?.forEach((tag) => tagSet.add(tag));
  });
  return Array.from(tagSet);
}

export function getItemById(id: string): Item | undefined {
  const items = getItems();
  return items.find((item) => item.id === id);
}

// ---- Write (used by fetch script) ----

export function saveItems(items: Item[]): void {
  writeJson('items.json', items);
}

export function saveSources(sources: Source[]): void {
  writeJson('sources.json', sources);
}
