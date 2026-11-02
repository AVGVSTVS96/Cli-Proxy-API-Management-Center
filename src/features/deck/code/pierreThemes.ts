// vite.config.ts points @pierre/theming/themes here: the dashboard only renders the Pierre themes,
// and the full catalog would inline every Shiki theme into the single-file build.
export { pierreThemes as themes } from '../../../../node_modules/@pierre/theming/dist/collections/pierre.js';
