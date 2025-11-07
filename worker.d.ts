declare module 'cloudflare:workers' {
  export const env: Record<string, string>;
  export const caches: CacheStorage;
  export const context: any;
}