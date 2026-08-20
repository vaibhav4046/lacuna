/**
 * Real vendor marks, and nothing drawn by hand.
 *
 * The icon set this replaced built every glyph as an inline path written here,
 * which is fine for a folder or a chip and is not fine for somebody else's
 * logo. Three of them were invented outright: HydraDB was three lines and four
 * circles, Claude was an eight-point starburst, and Codex was a hexagon. None
 * of those is the mark the company uses, and a submission that shows a partner
 * a logo it made up has said something untrue on the way to saying something
 * true.
 *
 * Each entry below records where the asset came from and under what terms, and
 * `THIRD_PARTY.md` carries the same list. Where no redistributable asset
 * exists, the answer is the company's name set in type rather than a drawing
 * that resembles one.
 */

/** HydraDB, from the official logo: orange tile, white stepped glyph. */
export const HYDRADB_MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-label="HydraDB">'
  + '<rect width="48" height="48" rx="8" fill="#ff5719"></rect>'
  + '<g fill="#ffffff" transform="translate(11 13)">'
  + '<rect x="0" y="0" width="6" height="7"></rect>'
  + '<rect x="0" y="11" width="13" height="5"></rect>'
  + '<rect x="0" y="15" width="6" height="7"></rect>'
  + '<rect x="20" y="0" width="6" height="6"></rect>'
  + '<rect x="13" y="6" width="13" height="5"></rect>'
  + '<rect x="20" y="15" width="6" height="7"></rect>'
  + '</g></svg>';

/**
 * The Google "G", in its official four colours and official geometry.
 *
 * Google publishes this mark specifically so that a Sign in with Google button
 * carries it, and the branding guidelines require the button to show it rather
 * than a wordmark alone. It is never recoloured, never flattened to one tone
 * and never redrawn: the four paths below are the official ones.
 */
export const GOOGLE_G =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-label="Google">'
  + '<path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>'
  + '<path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>'
  + '<path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/>'
  + '<path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/>'
  + '</svg>';

/** Anthropic's Claude mark. Bootstrap Icons v1.13, MIT. */
export const CLAUDE_MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" role="img" aria-label="Claude">'
  + '<path d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.041 1.977 1.53 2.583 1.902.379.315.151-.107.02-.077-.17-.284-1.408-2.545-1.505-2.586-.67-1.075-.177-.646a3.1 3.1 0 0 1-.108-.76L2.75.084 2.98 0l.556.076.234.202.345.79.56 1.246.868 1.692 1.254 2.448.38.945.203.874.076.267h.13v-.153l.107-1.42.198-1.744.19-2.244.066-.632.312-.755.62-.408.484.232.4.57-.056.37-.238 1.546-.466 2.424-.304 1.622h.178l.203-.203.822-1.09 1.38-1.724.609-.685.71-.756.456-.36h.862l.634.943-.284.973-.888 1.126-.736.954-1.056 1.42-.66 1.138.061.09.158-.015 2.394-.51 1.293-.234 1.543-.264.698.325.076.331-.275.677-1.65.407-1.935.387-2.882.681-.035.026.04.05 1.3.122.554.03h1.359l2.53.188.662.437.397.535-.066.407-1.018.519-1.375-.327-3.209-.763-1.1-.274h-.152v.09l.917.897 1.68 1.517 2.104 1.955.107.484-.27.382-.284-.04-1.845-1.386-.711-.626-1.611-1.356h-.107v.142l.371.544 1.962 2.95.101.905-.142.295-.508.178-.558-.102-1.147-1.61-1.183-1.813-.955-1.625-.117.067-.563 6.06-.264.31-.609.234-.507-.386-.269-.625.269-1.233.325-1.61.264-1.28.238-1.59.142-.528-.01-.036-.117.016-1.199 1.646-1.823 2.463-1.442 1.544-.345.137-.599-.31.056-.554.335-.493 1.995-2.539 1.203-1.573.777-.907-.005-.132h-.046L1.96 13.583l-.912.117-.392-.367.048-.601.187-.198 1.541-1.06z"/>'
  + '</svg>';

/** OpenAI's mark. Bootstrap Icons v1.13, MIT. */
export const OPENAI_MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" role="img" aria-label="OpenAI">'
  + '<path d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995a4.13 4.13 0 0 0 4.938-1.53 4 4 0 0 0 1.567-.68 4.04 4.04 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.507-4.644zm-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778a.05.05 0 0 1 .027.038v3.722a2.96 2.96 0 0 1-3.039 2.993M2.3 11.715a2.94 2.94 0 0 1-.361-2.01l.095.057 3.234 1.838a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.02.043L6.457 12.81A3.08 3.08 0 0 1 2.3 11.716zM1.448 4.802A3.06 3.06 0 0 1 3.05 3.475l-.002.109v3.68a.5.5 0 0 0 .262.452l3.93 2.237-1.366.779a.05.05 0 0 1-.046 0L2.6 8.878a3 3 0 0 1-1.153-4.076Zm11.216 2.552-3.94-2.256L10.09 4.32a.05.05 0 0 1 .046 0l3.264 1.855a3 3 0 0 1 1.152 4.079 3.06 3.06 0 0 1-1.6 1.325V7.805a.52.52 0 0 0-.288-.451m1.36-2.02-.096-.057-3.226-1.854a.53.53 0 0 0-.53 0L6.226 5.669V4.114a.05.05 0 0 1 .02-.043l3.264-1.854a3.07 3.07 0 0 1 4.55 3.118zM5.48 8.079 4.113 7.3a.05.05 0 0 1-.026-.037V3.54A3.07 3.07 0 0 1 9.13 1.196l-.096.053-3.23 1.838a.53.53 0 0 0-.264.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z"/>'
  + '</svg>';

/** The Model Context Protocol mark. modelcontextprotocol/docs, MIT. */
export const MCP_MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="8 10 180 186" fill="none" stroke="currentColor" stroke-width="14" stroke-linecap="round" role="img" aria-label="Model Context Protocol">'
  + '<path d="M25 97.8528L92.8823 29.9706C102.255 20.598 117.451 20.598 126.823 29.9706V29.9706C136.196 39.3431 136.196 54.5391 126.823 63.9117L75.5581 115.177"></path>'
  + '<path d="M76.2653 114.47L126.823 63.9117C136.196 54.5391 151.392 54.5391 160.765 63.9117L161.118 64.2652C170.491 73.6378 170.491 88.8338 161.118 98.2063L93.9377 165.386C91.1445 168.18 91.1445 172.708 93.9377 175.501L108.031 189.594"></path>'
  + '<path d="M109.15 46.2426L75.7276 79.6651C66.355 89.0377 66.355 104.234 75.7276 113.606V113.606C85.1002 122.979 100.296 122.979 109.669 113.606L143.091 80.1838"></path>'
  + '</svg>';

/** A data URI for an `img` src, so nothing is fetched and CSP stays as it is. */
export function markUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
