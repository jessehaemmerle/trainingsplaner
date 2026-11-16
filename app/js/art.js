// Hand-built SVG caricatures: one noodle-limbed, big-nosed athlete in a
// different predicament per sport. Everything is drawn in a 200 × 200 box.

const INK = '#1D1147';
const SKIN = '#FFCFA3';
const NOSE = '#FF9B85';
const WHITE = '#FFFDF5';

const curve = (pts) => (pts.length === 3
  ? `M${pts[0].join(' ')} Q${pts[1].join(' ')} ${pts[2].join(' ')}`
  : `M${pts.map((p) => p.join(' ')).join(' L')}`);
const stroke = (pts, w, color) => `<path d="${curve(pts)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
/** A limb or body part: coloured tube with an ink outline. */
const tube = (pts, color = SKIN, w = 10) => stroke(pts, w + 9, INK) + stroke(pts, w, color);
const ink = (pts, w = 5) => stroke(pts, w, INK);
const dot = (x, y, r, fill = SKIN, sw = 4.5) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${INK}" stroke-width="${sw}"/>`;
const shoe = (x, y, rot = 0, color = WHITE) => `<ellipse cx="${x}" cy="${y}" rx="13" ry="8" fill="${color}" stroke="${INK}" stroke-width="4.5" transform="rotate(${rot} ${x} ${y})"/>`;
const drop = (x, y, s = 1) => `<path d="M${x} ${y} q${6 * s} ${9 * s} 0 ${13 * s} q${-6 * s} ${-4 * s} 0 ${-13 * s}Z" fill="#BDEBFF" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`;
const star = (x, y, r, fill = '#FFC93C') => {
  const p = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    return `${(x + Math.cos(a) * rr).toFixed(1)} ${(y + Math.sin(a) * rr).toFixed(1)}`;
  });
  return `<path d="M${p.join(' L')}Z" fill="${fill}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`;
};

function head(x, y, { mouth = 'grin', eyes = 'open', gear = 'hair', color = WHITE, look = [3, 1] } = {}) {
  let s = dot(x, y, 30, SKIN, 5);
  // Headgear sits on the skull, under the face features.
  const dome = `M${x - 31} ${y - 6} A31 31 0 0 1 ${x + 31} ${y - 6}`;
  if (gear === 'hair') s += ink([[x - 8, y - 29], [x - 12, y - 42], [x - 2, y - 38]], 4.5) + ink([[x + 2, y - 30], [x + 4, y - 44], [x + 12, y - 36]], 4.5);
  if (gear === 'headband') {
    s += `<path d="M${x - 29} ${y - 9} Q${x} ${y - 24} ${x + 29} ${y - 9}" fill="none" stroke="${INK}" stroke-width="16" stroke-linecap="round"/>`
      + `<path d="M${x - 29} ${y - 9} Q${x} ${y - 24} ${x + 29} ${y - 9}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"/>`
      + ink([[x - 30, y - 8], [x - 46, y - 16]], 5) + ink([[x - 30, y - 6], [x - 45, y]], 5)
      + ink([[x - 4, y - 31], [x - 6, y - 42], [x + 4, y - 38]], 4.5);
  }
  if (['helmet', 'cap', 'beanie', 'visor'].includes(gear)) s += `<path d="${dome} Z" fill="${color}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`;
  if (gear === 'helmet') s += ink([[x - 12, y - 30], [x - 14, y - 12]], 4) + ink([[x + 4, y - 34], [x + 4, y - 12]], 4) + ink([[x + 19, y - 28], [x + 21, y - 12]], 4);
  if (gear === 'beanie') s += dot(x, y - 40, 9, WHITE) + `<path d="M${x - 31} ${y - 8} H${x + 31}" stroke="${INK}" stroke-width="13" stroke-linecap="round"/><path d="M${x - 31} ${y - 8} H${x + 31}" stroke="${WHITE}" stroke-width="5" stroke-linecap="round"/>`;
  if (gear === 'visor') s += `<path d="M${x + 14} ${y - 12} Q${x + 44} ${y - 16} ${x + 52} ${y - 4} Q${x + 34} ${y - 4} ${x + 24} ${y - 6}Z" fill="${color}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`;

  // Eyes
  if (eyes === 'open') {
    for (const dx of [-8, 13]) s += dot(x + dx, y - 3, 9.5, '#fff', 4) + `<circle cx="${x + dx + look[0]}" cy="${y - 3 + look[1]}" r="4" fill="${INK}"/>`;
  } else if (eyes === 'closed') {
    s += ink([[x - 16, y - 4], [x - 8, y + 3], [x, y - 4]], 4) + ink([[x + 6, y - 4], [x + 14, y + 3], [x + 22, y - 4]], 4);
  } else if (eyes === 'squeeze') {
    s += ink([[x - 16, y - 8], [x - 4, y - 2]], 4.5) + ink([[x - 16, y + 2], [x - 4, y - 2]], 4.5) + ink([[x + 24, y - 8], [x + 12, y - 2]], 4.5) + ink([[x + 24, y + 2], [x + 12, y - 2]], 4.5);
  } else if (eyes === 'goggles') {
    s += `<path d="M${x - 30} ${y - 4} H${x + 30}" stroke="${INK}" stroke-width="5"/>`;
    for (const dx of [-8, 14]) s += `<ellipse cx="${x + dx}" cy="${y - 3}" rx="11" ry="9" fill="#1D7FB8" stroke="${INK}" stroke-width="4.5"/><path d="M${x + dx - 5} ${y - 6} l5 -3" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`;
  }
  // The nose is the punchline.
  s += `<ellipse cx="${x + 6}" cy="${y + 9}" rx="11" ry="8.5" fill="${NOSE}" stroke="${INK}" stroke-width="4.5"/>`;
  // Mouth
  if (mouth === 'grin') s += `<path d="M${x - 14} ${y + 15} Q${x - 2} ${y + 31} ${x + 16} ${y + 19} Z" fill="#fff" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`;
  if (mouth === 'strain') s += `<rect x="${x - 13}" y="${y + 19}" width="26" height="8" rx="3" fill="#fff" stroke="${INK}" stroke-width="4"/>` + ink([[x - 4, y + 19], [x - 4, y + 27]], 2.5) + ink([[x + 4, y + 19], [x + 4, y + 27]], 2.5);
  if (mouth === 'calm') s += ink([[x - 10, y + 20], [x, y + 25], [x + 9, y + 20]], 4);
  if (mouth === 'o') s += `<ellipse cx="${x + 2}" cy="${y + 23}" rx="5" ry="4.5" fill="${INK}"/>`;
  return s;
}

const speed = (lines) => lines.map(([x1, y, x2]) => ink([[x1, y], [x2, y]], 4.5)).join('');
const mountain = (x, y, w, h, fill = WHITE) => `<path d="M${x} ${y} L${x + w / 2} ${y - h} L${x + w} ${y}Z" fill="${fill}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`
  + `<path d="M${x + w / 2 - w * 0.13} ${y - h * 0.74} l${w * 0.07} ${h * 0.09} l${w * 0.06} ${-h * 0.07} l${w * 0.07} ${h * 0.09} l${w * 0.06} ${-h * 0.1}" fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;

function runner(gear = 'headband', gearColor = '#FFC93C') {
  return tube([[100, 98], [76, 100], [70, 122]])                 // back arm
    + tube([[92, 132], [60, 138], [42, 120]]) + shoe(36, 116, -50) // back leg
    + tube([[108, 88], [92, 132]], WHITE, 26)                      // torso
    + tube([[92, 132], [124, 146], [134, 172]]) + shoe(142, 177, 10) // front leg
    + tube([[90, 130], [96, 136]], INK, 20)                         // shorts
    + head(120, 56, { gear, color: gearColor })
    + tube([[106, 96], [130, 114], [150, 96]]) + dot(152, 94, 7);
}

const SCENES = {
  run: () => speed([[14, 70, 44], [8, 96, 34], [18, 148, 40]]) + runner() + drop(160, 28) + drop(176, 50, 0.8)
    + ink([[20, 188], [180, 188]], 5),

  trail: () => mountain(96, 176, 100, 92) + `<path d="M-6 194 L206 148 V206 H-6Z" fill="#1FAE74" stroke="${INK}" stroke-width="5"/>`
    + `<g transform="rotate(-12 100 110) translate(14 -14)">${runner('visor', '#FF5A4E')}</g>` + drop(170, 30),

  bike: () => {
    const wheel = (x) => dot(x, 150, 28, 'none', 6) + dot(x, 150, 5, WHITE, 4);
    return speed([[6, 86, 30], [10, 112, 28]]) + wheel(52) + wheel(150)
      + ink([[52, 150], [88, 110], [132, 110], [150, 150]], 6) + ink([[88, 110], [104, 150], [52, 150]], 6) + ink([[132, 110], [128, 94], [142, 90]], 6)
      + ink([[78, 102], [98, 102]], 8)
      + tube([[90, 98], [118, 122], [104, 148]]) + shoe(104, 152, 0)
      + tube([[92, 96], [120, 70]], WHITE, 26)
      + head(142, 50, { gear: 'helmet', color: '#FF5A4E', mouth: 'grin' })
      + tube([[118, 76], [136, 96], [138, 92]]) + dot(138, 92, 7);
  },

  swim: () => {
    const wave = (y, fill) => `<path d="M-6 ${y} q13 -12 26 0 t26 0 t26 0 t26 0 t26 0 t26 0 t26 0 t26 0 V206 H-6Z" fill="${fill}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`;
    return tube([[112, 112], [150, 50], [176, 84]]) + dot(178, 86, 8)
      + head(88, 100, { gear: 'cap', color: '#FFC93C', eyes: 'goggles', mouth: 'o' })
      + wave(124, WHITE) + wave(150, '#BDEBFF') + wave(176, WHITE)
      + drop(140, 22) + drop(40, 60, 0.9) + drop(162, 30, 0.7);
  },

  strength: () => {
    const plate = (x, h) => `<rect x="${x}" y="${40 - h / 2}" width="13" height="${h}" rx="5" fill="${INK}"/>`;
    return ink([[18, 44], [100, 34], [182, 44]], 7) + plate(22, 56) + plate(38, 40) + plate(165, 56) + plate(149, 40)
      + tube([[86, 122], [58, 98], [66, 46]]) + tube([[114, 122], [142, 98], [134, 46]])
      + tube([[92, 150], [62, 156], [72, 180]]) + tube([[108, 150], [138, 156], [128, 180]])
      + shoe(68, 184, 0) + shoe(132, 184, 0)
      + tube([[100, 118], [100, 148]], WHITE, 34)
      + head(98, 90, { mouth: 'strain', eyes: 'squeeze', gear: 'headband', color: '#FF5A4E' })
      + dot(66, 44, 8) + dot(134, 44, 8)
      + drop(150, 78, 0.8) + drop(40, 80, 0.8)
      + ink([[12, 16], [20, 24]], 4) + ink([[188, 16], [180, 24]], 4);
  },

  core: () => ink([[10, 164], [190, 164]], 5)
    + tube([[62, 118], [34, 134], [26, 152]]) + shoe(24, 156, 60)
    + tube([[132, 112], [62, 120]], WHITE, 26)
    + tube([[130, 118], [134, 150], [156, 152]]) + dot(160, 152, 7)
    + head(152, 86, { mouth: 'strain', eyes: 'squeeze', gear: 'headband', color: '#FFC93C' })
    + drop(112, 132, 0.8) + drop(88, 138, 0.7)
    + dot(52, 60, 22, WHITE, 5) + ink([[52, 60], [52, 46]], 4.5) + ink([[52, 60], [62, 64]], 4.5) + ink([[46, 34], [58, 34]], 6),

  mobility: () => `<ellipse cx="100" cy="186" rx="52" ry="7" fill="${INK}" opacity=".25"/>`
    + tube([[100, 142], [50, 150], [94, 166]]) + tube([[100, 142], [150, 150], [106, 166]])
    + tube([[100, 100], [100, 140]], WHITE, 30)
    + tube([[90, 104], [58, 118], [56, 146]]) + tube([[110, 104], [142, 118], [144, 146]])
    + dot(56, 148, 7) + dot(144, 148, 7)
    + head(100, 66, { mouth: 'calm', eyes: 'closed', gear: 'hair' })
    + star(34, 46, 13, WHITE) + star(168, 62, 10, WHITE) + star(160, 22, 7, WHITE),

  hike: () => mountain(70, 190, 130, 130) + ink([[0, 190], [200, 190]], 5)
    + tube([[84, 98], [64, 104], [66, 124]])
    + `<rect x="50" y="86" width="30" height="46" rx="11" fill="#FF5A4E" stroke="${INK}" stroke-width="5"/>`
    + tube([[82, 134], [66, 154], [56, 178]]) + shoe(52, 182, 0, '#FFC93C')
    + tube([[88, 92], [82, 132]], WHITE, 26)
    + tube([[82, 134], [106, 152], [108, 178]]) + shoe(114, 182, 0, '#FFC93C')
    + head(96, 58, { gear: 'visor', color: '#FFC93C' })
    + ink([[124, 84], [136, 186]], 5)
    + tube([[90, 98], [112, 112], [126, 100]]) + dot(126, 100, 7),

  skitour: () => `<path d="M-6 196 L206 120 V206 H-6Z" fill="${WHITE}" stroke="${INK}" stroke-width="5"/>`
    + ink([[150, 70], [160, 136]], 4.5) + ink([[40, 176], [152, 136]], 7) + ink([[20, 170], [130, 131]], 7)
    + tube([[98, 104], [76, 108], [70, 126]]) + ink([[70, 122], [60, 164]], 4.5)
    + tube([[92, 132], [72, 146], [62, 164]])
    + tube([[100, 92], [92, 132]], '#FF5A4E', 26)
    + tube([[92, 132], [118, 134], [116, 146]])
    + head(108, 60, { gear: 'beanie', color: '#FFC93C' })
    + tube([[100, 98], [124, 108], [150, 92]]) + dot(150, 90, 7)
    + dot(30, 40, 4, WHITE, 3) + dot(170, 30, 5, WHITE, 3) + dot(56, 84, 3.5, WHITE, 3) + dot(184, 96, 4, WHITE, 3),

  xcski: () => `<path d="M-6 172 H206 V206 H-6Z" fill="${WHITE}" stroke="${INK}" stroke-width="5"/>`
    + speed([[8, 66, 34], [4, 100, 26]])
    + ink([[20, 170], [172, 170], [184, 162]], 7)
    + ink([[96, 110], [28, 166]], 4.5)
    + tube([[84, 126], [56, 146], [50, 164]])
    + tube([[114, 82], [84, 126]], '#FFC93C', 26)
    + tube([[84, 126], [116, 140], [124, 164]])
    + head(134, 58, { gear: 'beanie', color: '#FF5A4E' })
    + tube([[110, 92], [118, 116], [98, 110]]) + dot(96, 110, 7)
    + ink([[98, 108], [44, 168]], 4.5),

  climb: () => `<path d="M118 -6 L206 -6 V206 H96 L132 120 Z" fill="${WHITE}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`
    + dot(150, 30, 8, '#FF5A4E') + dot(140, 96, 8, '#FFC93C') + dot(134, 150, 8, '#2EC4F1') + dot(176, 70, 7, '#3DDC97') + dot(170, 140, 7, '#FF7AC3') + dot(120, 186, 8, '#8B5CF6')
    + tube([[86, 98], [112, 60], [144, 34]]) + dot(146, 32, 7)
    + tube([[74, 140], [60, 168], [112, 182]]) + shoe(116, 184, -10, '#FFC93C')
    + tube([[84, 96], [74, 140]], '#FF5A4E', 26)
    + tube([[76, 140], [108, 132], [128, 150]]) + shoe(130, 152, -30, '#FFC93C')
    + `<rect x="44" y="134" width="20" height="22" rx="7" fill="#FFC93C" stroke="${INK}" stroke-width="4.5"/>`
    + head(76, 60, { mouth: 'strain', look: [4, -3] })
    + tube([[90, 104], [118, 110], [136, 98]]) + dot(138, 97, 7)
    + drop(40, 76, 0.8),

  custom: () => star(160, 38, 20) + star(30, 58, 11, WHITE)
    + tube([[88, 108], [60, 86], [50, 54]]) + tube([[112, 108], [140, 90], [146, 66]])
    + dot(50, 52, 7) + dot(146, 64, 7)
    + tube([[92, 142], [80, 162], [78, 180]]) + tube([[108, 142], [124, 160], [124, 180]])
    + shoe(74, 184, 0) + shoe(130, 184, 0)
    + tube([[100, 106], [100, 140]], WHITE, 30)
    + head(100, 72, { look: [3, -3] }),

  hello: () => tube([[88, 110], [66, 126], [62, 148]]) + dot(62, 150, 7)
    + tube([[92, 146], [84, 164], [82, 180]]) + tube([[108, 146], [116, 164], [118, 180]])
    + shoe(78, 184, 0) + shoe(124, 184, 0)
    + tube([[100, 108], [100, 144]], WHITE, 30)
    + head(100, 74, { gear: 'headband', color: '#FF5A4E' })
    + tube([[112, 110], [142, 96], [150, 60]]) + dot(150, 58, 8)
    + ink([[166, 50], [174, 44]], 4) + ink([[168, 64], [178, 64]], 4) + ink([[160, 38], [162, 28]], 4),

  rest: () => ink([[20, 30], [20, 190]], 7) + ink([[180, 30], [180, 190]], 7)
    + `<path d="M20 70 Q100 190 180 70 Q100 130 20 70Z" fill="${WHITE}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`
    + tube([[120, 112], [150, 96], [160, 74]]) + shoe(162, 70, -60, '#FFC93C')
    + head(62, 92, { eyes: 'closed', mouth: 'calm', gear: 'hair' })
    + `<path d="M20 70 Q100 190 180 70" fill="none" stroke="${INK}" stroke-width="5"/>`
    + `<text x="98" y="62" font-family="Bagel Fat One, sans-serif" font-size="30" fill="${INK}">z</text>`
    + `<text x="120" y="42" font-family="Bagel Fat One, sans-serif" font-size="22" fill="${INK}">z</text>`
    + `<text x="138" y="26" font-family="Bagel Fat One, sans-serif" font-size="16" fill="${INK}">z</text>`,

  trophy: () => star(40, 44, 12, WHITE) + star(166, 36, 9, WHITE)
    + `<path d="M62 46 H138 V84 A38 38 0 0 1 62 84Z" fill="#FFC93C" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`
    + `<path d="M62 56 H40 Q40 92 68 96 M138 56 H160 Q160 92 132 96" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`
    + `<path d="M92 122 H108 V150 H92Z M70 150 H130 V172 H70Z" fill="#FFC93C" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`
    + dot(88, 76, 8, '#fff', 4) + dot(110, 76, 8, '#fff', 4) + `<circle cx="90" cy="77" r="3.5" fill="${INK}"/><circle cx="112" cy="77" r="3.5" fill="${INK}"/>`
    + ink([[86, 96], [100, 106], [114, 96]], 4.5),
};

/** Returns the SVG markup for a scene ("run", "bike", …, "rest", "hello", "trophy"). */
export function art(name, cls = '') {
  const scene = SCENES[name] || SCENES.custom;
  return `<svg class="art ${cls}" viewBox="0 0 200 200" aria-hidden="true" focusable="false">${scene()}</svg>`;
}

export const ART_NAMES = Object.keys(SCENES);

/** Small mood face for feedback, 1 (awful) … 5 (great). */
export function face(n, cls = '') {
  const fill = ['', '#FF5A4E', '#FF8A3D', '#FFC93C', '#9BD63B', '#3DDC97'][n] || '#FFC93C';
  const bend = [0, -9, -5, 0, 6, 11][n] || 0;
  const eyes = n === 5
    ? ink([[11, 17], [15, 12], [19, 17]], 3) + ink([[29, 17], [33, 12], [37, 17]], 3)
    : n === 1
      ? ink([[11, 13], [19, 17]], 3) + ink([[37, 13], [29, 17]], 3)
      : `<circle cx="15" cy="16" r="3.2" fill="${INK}"/><circle cx="33" cy="16" r="3.2" fill="${INK}"/>`;
  return `<svg class="face ${cls}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">`
    + `<circle cx="24" cy="24" r="20" fill="${fill}" stroke="${INK}" stroke-width="3.5"/>${eyes}`
    + `<path d="M14 ${31 - bend / 3} Q24 ${31 + bend} 34 ${31 - bend / 3}" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/></svg>`;
}

/** Line icons for navigation and buttons. */
const ICONS = {
  today: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  plan: '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  goals: '<path d="M6 21V4M6 4.5h11.5l-2.8 4 2.8 4H6"/>',
  progress: '<path d="M5 20v-6M12 20V5M19 20v-10"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M5.5 18.5l1.9-1.9M16.6 7.4l1.9-1.9"/>',
  left: '<path d="M14.5 5l-7 7 7 7"/>',
  right: '<path d="M9.5 5l7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  skip: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  warn: '<path d="M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.6v.2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4h-4"/>',
};
export const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
