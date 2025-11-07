declare module 'cloudflare:test' {
	interface ProvidedEnv extends Env {}
}
export interface Env {
  MORALIS_API_KEY: string;
}
