// 既存thank-you-card-onecomme-pluginのプラグイン境界を参考にした最小型。
export interface PluginRequest {
  method: string;
  body?: string;
}

export interface OneCommePlugin {
  name: string;
  uid: string;
  version: string;
  author: string;
  url: string;
  permissions: string[];
  init(params: unknown, initialData?: unknown): void;
  destroy(): void;
  subscribe(type: string, ...args: unknown[]): void;
  request(req: PluginRequest): Promise<{
    code: number;
    response: Record<string, unknown>;
  }>;
}
