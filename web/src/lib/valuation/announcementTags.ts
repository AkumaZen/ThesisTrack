// Deterministic keyword classifier for NSE announcements. It reads the exchange's category (the
// "desc" field, stored as the subject) first and falls back to the longer text, so it works with
// no LLM at all. Order matters: the first rule that matches wins, and routine paperwork is
// recognised before anything else so a trading-window notice never looks like a corporate event.

export const ANNOUNCEMENT_TAGS = [
	'results',
	'order_win',
	'fundraise',
	'pledge',
	'management',
	'rating',
	'mna',
	'corporate_action',
	'board_meeting',
	'regulatory',
	'routine',
	'other'
] as const;
export type AnnouncementTag = (typeof ANNOUNCEMENT_TAGS)[number];

export const TAG_LABELS: Record<AnnouncementTag, string> = {
	results: 'Results',
	order_win: 'Order win',
	fundraise: 'Fundraise',
	pledge: 'Pledge',
	management: 'Management change',
	rating: 'Credit rating',
	mna: 'M&A',
	corporate_action: 'Dividend / buyback',
	board_meeting: 'Board meeting',
	regulatory: 'Litigation / regulatory',
	routine: 'Routine',
	other: 'Other'
};

/** Announcement type as a .tag tone: risks read danger or warn, wins read good, other corporate events read info, paperwork stays muted. */
export const TAG_TONE: Record<AnnouncementTag, string> = {
	results: "tag-info",
	order_win: "tag-good",
	fundraise: "tag-info",
	pledge: "tag-danger",
	management: "tag-warn",
	rating: "tag-info",
	mna: "tag-info",
	corporate_action: "tag-info",
	board_meeting: "",
	regulatory: "tag-warn",
	routine: "tag-muted",
	other: ""
};

export const isAnnouncementTag = (v: unknown): v is AnnouncementTag =>
	typeof v === 'string' && (ANNOUNCEMENT_TAGS as readonly string[]).includes(v);

type Rule = [AnnouncementTag, RegExp];

const RULES: Rule[] = [
	[
		'routine',
		new RegExp(
			[
				'trading window',
				'newspaper (publication|advertisement)',
				'copy of newspaper',
				'(loss|duplicate|replacement) of share certificate',
				'share certificate',
				'certificate under (sebi )?\\(?(depositories|reg)',
				'regulation 74\\(5\\)|reg\\.? 74\\(5\\)',
				'regulation 40\\(9\\)|reg\\.? 40\\(9\\)',
				'compliance certificate',
				'secretarial compliance',
				'investor (grievance|complaints?)',
				'regulation 13\\(3\\)|reg\\.? 13\\(3\\)',
				'shareholding pattern',
				'voting results',
				's?c?rutini[sz]er',
				'\\be-?voting\\b',
				'\\besops?\\b|\\besos\\b|employee stock (option|purchase)',
				'reconciliation of share capital',
				'practicing company secretary',
				'compliances? ?-? ?reg',
				'monitoring agency report',
				'statement of deviation'
			].join('|'),
			'i'
		)
	],
	// A heads-up about a coming meeting is a board meeting even when it names the results.
	[
		'board_meeting',
		/board meeting intimation|intimation of (the )?board meeting|prior intimation|notice of (the )?board meeting|schedule of board meeting|date of board meeting|board meeting (to be held|on)/i
	],
	[
		'results',
		/financial results?|results? for the (quarter|year|half|period)|(quarterly|half[- ]yearly|annual|standalone|consolidated) results?|\b(un)?audited (financial|standalone|consolidated|results)|\bunaudited\b|\bq[1-4] ?fy ?\d{2,4}\b.*results?/i
	],
	['pledge', /pledge|encumbrance|invocation of|regulation 31\(\d\)|reg\.? 31\(\d\)/i],
	[
		'fundraise',
		/\bqip\b|rights committee|qualified institutional|preferential (issue|allotment|basis)|rights issue|rights entitlement|\bncds?\b|non-?convertible (debentures?|securities)|fund[- ]?raising|rais(e|ing) (of )?(funds|capital)|allotment of (equity|securities|shares|warrants|convertible|debentures)|\bfccbs?\b|convertible (warrants?|debentures?|bonds?)|\bdebentures?\b|\bipo\b|\bfpo\b|offer for sale|\bamount of ₹?\s?\d.*(raise|issue)/i
	],
	[
		'regulatory',
		/litigation|lawsuit|\bcourt\b|tribunal|\bnclt\b|\bnclat\b|show[- ]cause|penalty|\bpenalt|fine (of|imposed)|adjudicat|search and seizure|\bsearch operations?\b|enforcement directorate|action\(s\) initiated|orders? passed|regulatory action|disciplinary|investigation|\bfraud\b|default(s|ed)? (in|on|of)|insolvency (proceedings|resolution|petition)|\bcirp\b|\bsebi\b.*\b(order|notice)\b|income[- ]tax (department|demand|notice)|gst (demand|notice|authorit)|clarification sought|sought clarification|intimation of fine|imposition of fine|bfine ofb|suspension of trading|delisting/i
	],
	[
		'order_win',
		/bagging|receiving of orders?|receipt of (an? )?orders?|(received|secured|bagged|wins?|won|awarded)\b.{0,40}\b(orders?|contracts?|projects?)|\b(orders?|contracts?|projects?)\b.{0,30}\b(received|secured|bagged|awarded|worth)|letter of (award|intent|acceptance)|\bloa\b|\bloi\b|work order|purchase order|order inflow|order book|new orders?|empanel|\bl-?1 bidder|lowest bidder/i
	],
	[
		'mna',
		/acquisition|\bacquir(e|es|ed|ing)\b|merger|amalgamation|demerger|scheme of arrangement|\bopen offer\b|takeover|take over|slump sale|joint venture|\bjv\b|divest|strategic investment|(incorporation|formation) of .{0,40}subsidiary|wholly[- ]owned subsidiary|\bsast\b|restructuring|stake (sale|purchase)|investment in|disposal of|sale of (undertaking|business|stake)/i
	],
	[
		'rating',
		/credit rating|rating (action|assigned|reaffirm|upgrade|downgrade|revis|watch)|(reaffirm|upgrad|downgrad|assign|revis)\w*.{0,30}rating|updates? on rating|\b(crisil|icra|care ratings|india ratings|brickwork|acuite|ind-ra|infomerics)\b/i
	],
	[
		'corporate_action',
		/dividend|buy-?back|stock split|sub-?division of|split of|bonus (issue|shares?|equity)|issue of bonus|record date|\bex-?date\b|capital reduction|consolidation of (equity )?shares|reduction of capital/i
	],
	[
		'management',
		/change in (directors?|key managerial|kmp|auditors?|senior management|management|compliance officer)|directorship|resign|appoint(ment|ed|s)?\b|cessation|key managerial|\bkmp\b|\b(cfo|ceo|coo)\b|managing director|whole[- ]time director|company secretary|statutory auditor|secretarial auditor|re-?appointment|compliance officer|share transfer agent|senior management/i
	]
];

/** Only when nothing more specific matched in either text. */
const BOARD_MEETING_FALLBACK = /board meeting|outcome of|board of directors/i;

/** Tags a filing from the exchange's category (subject), its headline and its details. The
 *  category is tried alone first: it is the exchange's own label, while the details of a long
 *  filing can mention many unrelated things. */
export function classifyAnnouncement(subject: string, details = '', headline = ''): AnnouncementTag {
	// SAST disclosures are a pledge when made under Regulation 31 and a change of stake otherwise.
	if (/takeover regulations|\bsast\b/i.test(subject)) {
		return /regulation 31|reg\.? 31|encumbr|pledge/i.test(details) ? 'pledge' : 'mna';
	}
	const first = `${subject} ${headline}`.trim();
	for (const text of [first, `${first} ${details}`]) {
		if (!text.trim()) continue;
		for (const [tag, re] of RULES) {
			if (re.test(text)) return tag;
		}
	}
	return BOARD_MEETING_FALLBACK.test(`${first} ${details}`) ? 'board_meeting' : 'other';
}

/** Filings that are not worth an interruption (shown and stored, but not pushed when the person
 *  asked for important filings only). */
export const isRoutine = (tag: string | null | undefined) => tag === 'routine';

/** Title prefix for a push: "[Results] ". Nothing for untagged filings. */
export const tagPrefix = (tag: string | null | undefined) =>
	isAnnouncementTag(tag) && tag !== 'other' ? `[${TAG_LABELS[tag]}] ` : '';
