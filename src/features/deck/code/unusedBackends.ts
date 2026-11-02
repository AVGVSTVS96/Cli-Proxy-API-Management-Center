// vite.config.ts points the WebAssembly highlighters here, keeping them out of the single-file
// build: the dashboard highlights with Shiki's JavaScript engine only.
const unused = () => {
  throw new Error('Only the shiki-js highlighter is bundled');
};

export const codeToTokens = unused;
export const isSupportedLanguage = unused;
export const LiveTokenizer = unused;
export const StreamTokenizer = unused;
export const themes = {};
export default unused;
