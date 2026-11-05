export const BRAND_NAME = 'BROADCOM';

const MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" rx="7" fill="#0a0a0a"/>' +
  '<rect x="7" y="8" width="18" height="4" rx="1" fill="#ff8a1f"/>' +
  '<rect x="7" y="14" width="13" height="4" rx="1" fill="#ededed"/>' +
  '<rect x="7" y="20" width="8" height="4" rx="1" fill="#ededed"/>' +
  '</svg>';

export const BRAND_MARK = `data:image/svg+xml,${encodeURIComponent(MARK_SVG)}`;
