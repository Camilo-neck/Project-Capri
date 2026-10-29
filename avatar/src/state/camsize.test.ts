import assert from "node:assert/strict";
import { test } from "node:test";

import { CAM_MAX, CAM_MIN, camHeight, camResize, camWidth } from "./camsize.ts";

test("dragging a corner out makes it bigger, keeping 3:2, growing evenly about her spot", () => {
  assert.equal(camResize(336, "tr", 20, 0), 376); // 20 px right: both sides grow 20
  assert.equal(camResize(336, "tl", -20, 0), 376); // the left one, to the left
  assert.equal(camResize(336, "tl", 0, -30), 381); // up 30: 30 taller, 45 wider
  assert.equal(camHeight(381), 254);
});

test("dragging inward makes it smaller", () => {
  assert.equal(camResize(336, "br", -20, 0), 296);
  assert.equal(camResize(336, "tr", 0, 30), 291); // a top corner down
});

test("the bigger of the two movements wins, and it never leaves its limits", () => {
  assert.equal(camResize(336, "tr", 10, -40), 396); // up 40 (60 wider) beats right 10 (20 wider)
  assert.equal(camResize(336, "tr", 1000, 0), CAM_MAX);
  assert.equal(camResize(336, "bl", 1000, 0), CAM_MIN); // a left corner to the right: smaller
});

test("a saved width outside the limits comes back inside them", () => {
  assert.equal(camWidth(10), CAM_MIN);
  assert.equal(camWidth(9999), CAM_MAX);
  assert.equal(camWidth(Number.NaN), 336);
});
