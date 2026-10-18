import type { PageServerLoad } from './$types';
import { telegramConfigured } from '$lib/server/telegram';
import { pushConfigured } from '$lib/server/webPush';
import { getHoldingSettings, lastStoredCloses, listPriceRules } from '$lib/valuation/server/marketIntelStore';
import { getTelegramChat } from '$lib/valuation/server/telegramStore';
import { listSubscriptions } from '$lib/valuation/server/announcementStore';

// The person's own price and shareholding alerts. Delivery goes through the same Web Push and
// Telegram setup as announcement alerts (managed on the tracked companies page).
export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const rules = await listPriceRules(userId);
	const prices = await lastStoredCloses([...new Set(rules.map((r) => r.nseSymbol))]);
	const [holding, subscriptions, telegramChat] = await Promise.all([
		getHoldingSettings(userId),
		listSubscriptions(userId),
		telegramConfigured() ? getTelegramChat(userId) : Promise.resolve(null)
	]);
	return {
		rules: rules.map((r) => ({
			id: r.id,
			nseSymbol: r.nseSymbol,
			companyName: r.companyName,
			kind: r.kind,
			threshold: r.threshold,
			basePrice: r.basePrice,
			active: r.active,
			triggeredAt: r.triggeredAt?.toISOString() ?? null,
			triggeredPrice: r.triggeredPrice,
			price: prices.get(r.nseSymbol) ?? null
		})),
		holding,
		delivery: {
			push: pushConfigured() && subscriptions.length > 0,
			pushAvailable: pushConfigured(),
			telegram: telegramConfigured() && Boolean(telegramChat)
		}
	};
};
