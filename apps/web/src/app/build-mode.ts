/** Compile-time flag: the public preview has no live application capability. */
export const isStaticPreview = typeof __DAYU_STATIC_PREVIEW__ !== "undefined" && __DAYU_STATIC_PREVIEW__;
