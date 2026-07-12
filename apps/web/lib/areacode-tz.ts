// NANP area code → IANA timezone, for the recipient-local calling window
// (rule 3: never dial outside 8am–9pm where the phone rings).
//
// Codes whose region spans two timezones map to BOTH — the caller must be
// in-window in every candidate zone, so a split code is dialable only in the
// hours the two zones agree on. Unknown codes (Canada, new overlays) fall back
// to CONSERVATIVE_ZONES: in-window on both US coasts at once.
// ponytail: static US map, maintained by hand — swap for a maintained dataset
// if campaigns ever dial outside the US.

const ZONES: Record<string, number[]> = {
  'America/New_York': [
    // NJ / DC / CT / ME / NY / PA / OH / MD / MI / DE / RI / NH / VT
    201, 551, 609, 640, 732, 848, 856, 862, 908, 973, 202, 771, 203, 475, 860, 959, 207,
    212, 315, 332, 347, 516, 518, 585, 607, 631, 646, 680, 716, 718, 838, 845, 914, 917, 929, 934,
    215, 223, 267, 272, 412, 445, 484, 570, 582, 610, 717, 724, 814, 878,
    216, 220, 234, 283, 326, 330, 380, 419, 440, 513, 567, 614, 740, 937,
    240, 301, 410, 443, 667, 302, 401, 603, 802,
    231, 248, 269, 313, 517, 586, 616, 734, 810, 906, 947, 989,
    // FL (peninsula) / GA / VA / WV / NC / SC / MA
    239, 305, 321, 352, 386, 407, 561, 689, 727, 754, 772, 786, 813, 863, 904, 941,
    229, 404, 470, 478, 678, 706, 762, 770, 912, 943,
    276, 434, 540, 571, 703, 757, 804, 304, 681,
    252, 336, 704, 743, 828, 910, 919, 980, 984, 803, 839, 843, 854, 864,
    339, 351, 413, 508, 617, 774, 781, 857, 978,
    // Eastern IN / KY / TN
    260, 317, 463, 574, 765, 502, 606, 859, 423, 865,
  ],
  'America/Chicago': [
    // IL / TX / MN / WI / MO / IA / AR / LA / MS / AL / OK / KS / NE
    217, 224, 309, 312, 331, 447, 618, 630, 708, 773, 779, 815, 847, 872,
    210, 214, 254, 281, 325, 346, 361, 409, 430, 432, 469, 512, 682, 713, 726, 737, 806, 817,
    830, 832, 903, 936, 940, 956, 972, 979,
    218, 320, 507, 612, 651, 763, 952, 262, 414, 534, 608, 715, 920,
    314, 417, 573, 636, 660, 816, 319, 515, 563, 641, 712, 479, 501, 870,
    225, 318, 337, 504, 985, 228, 601, 662, 769, 205, 251, 256, 334, 659, 938,
    405, 539, 580, 918, 316, 620, 785, 913, 402, 531,
    // Central IN / KY / TN
    219, 270, 364, 615, 629, 731, 901, 931,
  ],
  'America/Denver': [303, 719, 720, 970, 983, 385, 435, 801, 505, 575, 307, 406, 915],
  'America/Phoenix': [480, 520, 602, 623], // AZ, no DST
  'America/Los_Angeles': [
    209, 213, 279, 310, 323, 341, 408, 415, 424, 442, 510, 530, 559, 562, 619, 626, 628, 650,
    657, 661, 669, 707, 714, 747, 760, 805, 818, 820, 831, 840, 858, 909, 916, 925, 949, 951,
    206, 253, 360, 425, 509, 564, 503, 971, 702, 725, 775,
  ],
  'America/Anchorage': [907],
  'Pacific/Honolulu': [808],
  'America/Puerto_Rico': [787, 939, 340],
}

/** Area codes spanning two zones — must be in-window in both to dial. */
const SPLIT: Record<number, string[]> = {
  850: ['America/New_York', 'America/Chicago'], // FL panhandle
  812: ['America/New_York', 'America/Chicago'], // S Indiana
  930: ['America/New_York', 'America/Chicago'],
  308: ['America/Chicago', 'America/Denver'], // W Nebraska
  605: ['America/Chicago', 'America/Denver'], // South Dakota
  701: ['America/Chicago', 'America/Denver'], // North Dakota
  208: ['America/Denver', 'America/Los_Angeles'], // Idaho
  986: ['America/Denver', 'America/Los_Angeles'],
  541: ['America/Los_Angeles', 'America/Denver'], // E Oregon (Ontario)
  458: ['America/Los_Angeles', 'America/Denver'],
  928: ['America/Phoenix', 'America/Denver'], // AZ incl. Navajo Nation (DST)
}

const BY_CODE = new Map<number, string[]>()
for (const [tz, codes] of Object.entries(ZONES)) for (const c of codes) BY_CODE.set(c, [tz])
for (const [c, tzs] of Object.entries(SPLIT)) BY_CODE.set(Number(c), tzs)

/** Dialable only when it's daytime on both coasts — the unknown-code fallback. */
export const CONSERVATIVE_ZONES = ['America/New_York', 'America/Los_Angeles']

/** Candidate timezones for a +1 number, [] when unknown. */
export function zonesFor(e164: string): string[] {
  const m = /^\+1(\d{3})/.exec(e164)
  if (!m) return []
  return BY_CODE.get(Number(m[1])) ?? []
}

/** Hour-of-day (0–23) in a timezone. */
export function localHour(tz: string, now: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now)
  )
}
