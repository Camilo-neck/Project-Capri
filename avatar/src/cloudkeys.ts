// Where each cloud brain gives its API keys (the page the wizard opens, tray.rs open_web allows exactly these) and a
// word on it, for the panel and the wizard.
export const KEY_PAGES: Record<string, { page: string; hint: string }> = {
  anthropic: { page: "https://console.anthropic.com/settings/keys", hint: "console.anthropic.com" },
  openai: { page: "https://platform.openai.com/api-keys", hint: "platform.openai.com" },
  gemini: { page: "https://aistudio.google.com/apikey", hint: "aistudio.google.com (tiene uso gratis)" },
  openrouter: { page: "https://openrouter.ai/keys", hint: "openrouter.ai (muchos modelos, algunos gratis)" },
  groq: { page: "https://console.groq.com/keys", hint: "console.groq.com (rápido, tiene uso gratis)" },
  mistral: { page: "https://console.mistral.ai/api-keys", hint: "console.mistral.ai" },
  deepseek: { page: "https://platform.deepseek.com/api_keys", hint: "platform.deepseek.com" },
  xai: { page: "https://console.x.ai", hint: "console.x.ai" },
};
