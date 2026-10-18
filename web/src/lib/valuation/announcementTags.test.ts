import { describe, expect, it } from 'vitest';
import { classifyAnnouncement, isRoutine, tagPrefix, type AnnouncementTag } from './announcementTags';

// [category (desc), details, expected]. Subjects and wording are real NSE rows (HFCL, RELIANCE, JPPOWER,
// SUZLON, IRFC, ADANIENT, VEDL, July to October 2026) plus a few synthetic intimations.
const CASES: [string, string, AnnouncementTag][] = [
	['General Updates', 'HFCL Limited has informed the Exchange about Intimation of ESG rating by ESG Risk Assessments and Insights Limited', 'other'],
	['Updates', "HFCL Limited has informed the Exchange regarding 'Certificate under Regulation 74(5) of the SEBI (Depository and Participants) Regulations, 2018, for the Quarter ended 30th September, 2026'.", 'routine'],
	['Analysts/Institutional Investor Meet/Con. Call Updates', 'HFCL Limited has informed the Exchange about Schedule of meet', 'other'],
	['Trading Window', 'HFCL Limited has informed the Exchange regarding the Trading Window closure pursuant to SEBI (Prohibition of Insider Trading) Regulations, 2015', 'routine'],
	['Shareholders meeting', 'HFCL Limited has submitted the Exchange a copy Srutinizers report of Annual General Meeting held on September 29, 2026', 'routine'],
	['Copy of Newspaper Publication', 'Public Notice by way of Advertisement in Newspapers - Special Window for re-lodgment of Transfer requests', 'routine'],
	['Press Release', 'HFCL Limited has informed the Exchange regarding a press release titled "Press Release on approval of Additional Investment of Approximately 820 crore for expansion"', 'other'],
	['Capacity addition', 'HFCL Limited has informed the Exchange about Capacity addition', 'other'],
	['Record Date', 'HFCL Limited has informed the Exchange that Record date for the purpose of Dividend is 22-Sep-2026.', 'corporate_action'],
	['Bagging/Receiving of orders/contracts', 'HFCL Limited has informed the Exchange Intimation for entering into a long term supply agreement with a customer for supply of Optical Fiber Cables', 'order_win'],
	['Monitoring Agency Report', 'Monitoring Agency Reports on the utilisation of proceeds raised through Qualified Institutions Placements and Preferential Issue of Warrants', 'routine'],
	['Investor Presentation', 'HFCL Limited has informed the Exchange about Investor Presentation', 'other'],
	['Outcome of Board Meeting', 'HFCL Limited has submitted to the Exchange, the financial results for the period ended Jun 30, 2026.', 'results'],
	['Financial Results', 'Unaudited financial results for the quarter ended September 30, 2026', 'results'],
	['Board Meeting Intimation', 'HFCL LIMITED has informed the Exchange about Board Meeting to be held on 19-Oct-2026 to inter-alia consider and approve the Unaudited Financial results', 'board_meeting'],
	['Credit Rating', 'HFCL Limited has informed the Exchange about Credit Rating', 'rating'],
	['Action(s) taken or orders passed', 'Disclosure under Regulation 30 of the SEBI (LODR) Regulations, 2015 is attached.', 'regulatory'],
	['Allotment of Securities', 'The Company has today allotted 13,00,000 Unsecured, Redeemable, Non-Convertible Debentures ("NCDs")', 'fundraise'],
	['Other Restructuring', 'Roptonal Limited, a step-down subsidiary of the Company, stands dissolved with effect from August 18, 2026', 'mna'],
	['Amendment to AOA/MOA', 'Reliance Industries Limited has informed the Exchange regarding the Amendment to AOA/MOA of the company.', 'other'],
	['News Verification', 'The Exchange has sought clarification from Reliance Industries Limited with respect to recent news item', 'regulatory'],
	['Disclosure under SEBI Takeover Regulations', 'Reliance Welfare Association has Submitted a copy of Disclosure under Regulation 31(4) of the SEBI (Substantial Acquisition of Shares and Takeovers) Regulations', 'pledge'],
	['Disclosure under SEBI Takeover Regulations', 'Disclosure under Regulation 29(2) of SEBI (SAST) Regulations, 2011', 'mna'],
	['Certificate under SEBI (Depositories and Participants) Regulations, 2018', 'Jaiprakash Power Ventures Limited has informed the Exchange about Certificate under SEBI (Depositories and Participants) Regulations, 2018', 'routine'],
	['Retirement', 'Disclosure under Regulation 30 Cessation of Chief Financial Officer and Company Secretary & Compliance Officer (Key Managerial Personnel)', 'management'],
	['Cessation', 'Cessation of Smt. Vandana R. Singh (DIN: 03556920) as Independent Director of the Company.', 'management'],
	['Credit Rating- Others', 'Jaiprakash Power Ventures Limited has informed the Exchange about Credit Rating- Others', 'rating'],
	['Resignation of Director/KMP/SMP', 'Jaiprakash Power Ventures Limited has informed the Exchange about Resignation of Director/KMP/SMP', 'management'],
	['Resignation', 'Intimation of Resignation by Non-Executive Director - Regulation 30', 'management'],
	['Rumour Verification - Regulation 30(11)', 'Suzlon Energy Limited has informed the Exchange about Rumour Verification - Regulation 30(11)', 'other'],
	['ESOP/ESOS/ESPS', 'Suzlon Energy Limited has informed the Exchange regarding Allotment of 640726 Shares.', 'routine'],
	['Appointment', 'Suzlon Energy Limited has informed the Exchange regarding Appointment of Ms Manjari Upadhye', 'management'],
	['Dividend', 'IRFC has informed the Exchange that Board of Directors at its meeting held on October 15, 2026, declared Interim Dividend of Rs. 1.15 per equity share.', 'corporate_action'],
	['Pendency of Litigation(s)/dispute(s) or the outcome impacting the Company', 'IRFC has informed the Exchange about Pendency of Litigation(s)/dispute(s)', 'regulatory'],
	['Change in Auditors', 'IRFC has informed the Exchange regarding Change in Auditors of the company.', 'management'],
	['Credit Rating- Revision', 'IRFC has informed the Exchange about Credit Rating- Revision', 'rating'],
	['Disclosure of material issue', 'Disclosure under regulation 30 of SEBI (LODR) Regulations, 2015 -Intimation of fine', 'regulatory'],
	['Change in Director(s)', 'IRFC has informed the Exchange regarding Change in Director(s) of the company.', 'management'],
	['Change in Management', 'Disclosure under Regulation 30 of SEBI (LODR) Regulations, 2015 Change in Management', 'management'],
	['Credit Rating- New', 'Intimation of Credit Rating assigned by S&P Global Ratings', 'rating'],
	['Committee Meeting Updates', 'Adani Enterprises Limited has informed the Exchange regarding Outcome of Rights Committee Meeting held on Wednesday, September 30, 2026.', 'fundraise'],
	['Acquisition', 'Adani Enterprises Limited has informed the Exchange about acquisition of 50% stake of Monvarex Aluminium Holding RSC Ltd.', 'mna'],
	['Agreements', 'Adani Enterprises Limited has informed the Exchange about entering to into shareholders agreement by the Company', 'other'],
	['Suspension of Trading', 'trading in Non-Convertible Debentures of Adani Enterprises Limited shall be suspended w.e.f. August 28, 2026', 'regulatory'],
	['Statement of deviation(s) or variation(s) under Reg. 32', 'Adani Enterprises Limited has informed the Exchange about statement of deviation(s) or variation(s) under Reg. 32', 'routine'],
	['Qualified Institutional Placement', 'Allotment of Equity Shares to all Eligible Qualified Institutional Buyers.', 'fundraise'],
	['Issue of Securities', 'Vedanta Limited has informed the Exchange about issuance of Non-Convertible Debentures', 'fundraise'],
	['Scheme of Arrangement', 'Vedanta Limited has informed the Exchange about Scheme of Arrangement', 'mna'],
	['Options to purchase securities', 'Vedanta Limited has informed the Exchange about Options to purchase securities', 'other'],
	['Arrangements for strategic, technical, manufacturing, or marketing tie up', 'Signing of Joint Venture Agreement with Titagarh Rail Systems Limited', 'mna'],
	['Loss of Share Certificates', 'Intimation of loss of share certificate and issue of duplicate certificate', 'routine'],
	['Regulation 30 (LODR)-Newspaper Publication', 'Financial results published in newspapers', 'routine'],
	['Buy Back', 'Board approved buyback of equity shares', 'corporate_action'],
	['Outcome of Board Meeting', 'Approved sub-division of equity shares and issue of bonus shares', 'corporate_action'],
	['Outcome of Board Meeting', 'The Board approved appointment of a new auditor', 'management'],
	['Outcome of Board Meeting', 'Board approved routine items', 'board_meeting'],
	['Disclosure under Reg. 31', 'Creation of pledge on shares held by the promoter', 'pledge']
];

describe('classifyAnnouncement', () => {
	it.each(CASES)('%s -> %s', (subject, details, expected) => {
		expect(classifyAnnouncement(subject, details)).toBe(expected);
	});

	it('works with the category alone', () => {
		expect(classifyAnnouncement('Bagging/Receiving of orders/contracts')).toBe('order_win');
		expect(classifyAnnouncement('')).toBe('other');
	});

	it('tags a Reg 30 headline from its own words', () => {
		expect(classifyAnnouncement('General Updates', '', 'Receipt of order worth Rs 120 crore from NHAI')).toBe('order_win');
	});
});

describe('tag helpers', () => {
	it('knows what is routine', () => {
		expect(isRoutine('routine')).toBe(true);
		expect(isRoutine('results')).toBe(false);
		expect(isRoutine(null)).toBe(false);
	});
	it('prefixes known tags only', () => {
		expect(tagPrefix('results')).toBe('[Results] ');
		expect(tagPrefix('other')).toBe('');
		expect(tagPrefix(null)).toBe('');
		expect(tagPrefix('bogus')).toBe('');
	});
});
