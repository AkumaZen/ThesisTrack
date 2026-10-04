/**
 * Fine-grained thematic/value-chain baskets that don't have an official NSE sectoral index (so
 * there's no index token to pull from Angel One, unlike SECTOR_INDICES). Each basket is a
 * hand-picked list of NSE-listed constituents, verified against Screener.in, that the rotation
 * math treats as a synthetic equal-weighted index: normalize each stock's close to 100 on the
 * earliest common date, then average across the basket per day (see sectorRotationCache.ts).
 *
 * Sourced from a granular thematic taxonomy dossier covering the Indian listed equity universe
 * (NSE+BSE), organized Sector -> Theme -> constituents. Unlisted names the dossier itself flags
 * (Zoho, Tata Electronics, Tata AutoComp, CtrlS/Yotta/STT GDC, Serum Institute, etc.) are
 * excluded — this file only holds tickers that actually trade.
 */
export interface CustomSector {
	key: string;
	label: string;
	symbols: string[];
}

export const CUSTOM_SECTORS: CustomSector[] = [
	// ---------- Sector 1: Information Technology, AI & Digital Infrastructure ----------
	{
		key: 'dc_land_powered_shell',
		label: 'Land & Powered Shell',
		symbols: ['LODHA']
	},
	{
		key: 'dc_power_gen_transmission_grid',
		label: 'Power Generation, Transmission & Grid',
		symbols: ['ADANIGREEN', 'NTPCGREEN', 'ADANIENSOL', 'KEC']
	},
	{
		key: 'dc_electrical_equipment_distribution',
		label: 'Electrical Equipment & Power Distribution',
		symbols: [
			'POWERINDIA',
			'CGPOWER',
			'ABB',
			'SIEMENS',
			'ENRIN',
			'GVT&D',
			'VOLTAMP',
			'MARINE',
			'SCHNEIDER'
		]
	},
	{
		key: 'dc_backup_power',
		label: 'Backup Power (Gensets & Batteries)',
		symbols: ['CUMMINSIND', 'KIRLOSENG', 'TRITURBINE', 'ARE&M', 'EXIDEIND']
	},
	{
		key: 'dc_cables_connectivity',
		label: 'Cables & Connectivity (Power + Fibre)',
		symbols: ['POLYCAB', 'KEI', 'APARINDS', 'STLTECH', 'HFCL', 'TEJASNET']
	},
	{
		key: 'dc_cooling_thermal',
		label: 'Cooling & Thermal Management',
		symbols: ['BLUESTARCO', 'VOLTAS', 'KRN', 'THERMAX']
	},
	{
		key: 'dc_construction_mep',
		label: 'Construction, MEP & DC Integration Services',
		symbols: ['BBOX', 'AHLUCONT']
	},
	{
		key: 'ai_compute_servers_gpu',
		label: 'AI Compute, Servers & GPU Cloud',
		symbols: ['NETWEB', 'SYRMA', 'E2E']
	},
	{
		key: 'dc_it_hardware_distribution',
		label: 'IT Hardware Distribution',
		symbols: ['REDINGTON']
	},
	{
		key: 'dc_colocation_hyperscale_operators',
		label: 'Colocation & Hyperscale DC Operators',
		symbols: [
			'BHARTIARTL',
			'ADANIENT',
			'RELIANCE',
			'LT',
			'TCS',
			'HCLTECH',
			'ANANTRAJ',
			'TECHNOE',
			'RAILTEL'
		]
	},
	{
		key: 'dc_connectivity_subsea',
		label: 'Connectivity, Subsea & Interconnection',
		symbols: ['TATACOMM']
	},
	{
		key: 'it_services_saas',
		label: 'IT Services & Vertical SaaS',
		symbols: [
			'TCS',
			'INFY',
			'HCLTECH',
			'WIPRO',
			'TECHM',
			'NEWGEN',
			'INTELLECT',
			'KPITTECH',
			'CYIENT',
			'TATAELXSI',
			'ZENSARTECH',
			'SONATSOFTW'
		]
	},

	// ---------- Sector 2: Semiconductors & Electronics Manufacturing ----------
	// Re-carved from a user-supplied listed-companies dataset (Sept 2026) covering the full
	// Indian semiconductor value chain, not just OSAT/PCB. SPEL (BSE-only, code 517166),
	// AIMTRON and SAHASRA (NSE SME board) are included as given in that dataset even though
	// their fetch behavior via Angel One is unverified — included at the user's explicit
	// request despite falling outside this app's usual NSE-main-board convention.
	{
		key: 'chip_design_ip',
		label: 'Chip Design & IP',
		symbols: [
			'HCLTECH',
			'LTTS',
			'TATATECH',
			'TATAELXSI',
			'KPITTECH',
			'CYIENT',
			'MOSCHIP',
			'SASKEN',
			'MINDTECK'
		]
	},
	{ key: 'semicon_gases', label: 'Specialty Gases', symbols: ['LINDEINDIA', 'ELLEN'] },
	{
		key: 'semicon_chemicals',
		label: 'Specialty Chemicals',
		symbols: ['NAVINFLUOR', 'JUBLINGREA', 'AMIORG']
	},
	{ key: 'semicon_fluoropolymers', label: 'Fluoropolymers', symbols: ['FLUOROCHEM'] },
	{ key: 'semicon_ultrapure_water', label: 'Ultrapure Water', symbols: ['THERMAX', 'IONEXCHANG'] },
	{ key: 'semicon_cleanroom', label: 'Cleanroom', symbols: ['HVAX'] },
	{ key: 'semicon_fab_equipment', label: 'Fab Equipment', symbols: ['ASMTEC'] },
	{
		key: 'semicon_fabrication_foundries',
		label: 'Fabrication & Foundries',
		symbols: ['VEDL', 'RIR']
	},
	{
		key: 'osat_atmp',
		label: 'OSAT / ATMP',
		symbols: ['CGPOWER', 'KAYNES', 'SPEL', 'SAHASRA']
	},
	{
		key: 'ems_system_integration',
		label: 'EMS (Indirect Exposure Only)',
		symbols: ['BEL', 'DIXON', 'SYRMA', 'DATAPATTNS', 'CYIENTDLM', 'AVALON', 'CENTUM', 'AIMTRON']
	},
	{
		key: 'power_semiconductors_discretes',
		label: 'Power Semiconductors / Discretes',
		symbols: ['HIRECT']
	},
	{
		key: 'semiconductor_distribution',
		label: 'Distribution (Indirect Exposure Only)',
		symbols: ['REDINGTON', 'RPTECH']
	},

	// ---------- Sector 3: Automobile & EV Value Chain ----------
	{
		key: 'ev_cells_batteries',
		label: 'EV Cells & Battery Manufacturing',
		symbols: ['EXIDEIND', 'ARE&M', 'HBLENGINE']
	},
	{
		key: 'ev_powertrain',
		label: 'EV Powertrain (Motors/Controllers/BMS)',
		symbols: ['SONACOMS', 'UNOMINDA', 'ENDURANCE', 'SUPRAJIT']
	},
	{
		key: 'ev_auto_oems',
		label: 'EV / Auto OEMs',
		symbols: [
			'TATAMOTORS',
			'M&M',
			'OLAELEC',
			'ATHERENERG',
			'TVSMOTOR',
			'BAJAJ-AUTO',
			'HEROMOTOCO',
			'MARUTI'
		]
	},
	{
		key: 'traditional_auto_components',
		label: 'Traditional Auto Components',
		symbols: [
			'BHARATFORG',
			'MOTHERSON',
			'LUMAXIND',
			'VARROC',
			'SUPRAJIT',
			'CRAFTSMAN',
			'ENDURANCE',
			'BALKRISIND'
		]
	},

	// ---------- Sector 4: Pharma & Healthcare ----------
	{
		key: 'cdmo_crdmo',
		label: 'CDMO / CRDMO',
		symbols: [
			'DIVISLAB',
			'SYNGENE',
			'SAILIFE',
			'LAURUSLABS',
			'ANTHEM',
			'CONCORDBIO',
			'NEULANDLAB',
			'PPLPHARMA',
			'COHANCE',
			'JUBLPHARMA',
			'GLAND'
		]
	},
	{
		key: 'pharma_apis',
		label: 'Pharma APIs / Intermediates',
		symbols: [
			'DIVISLAB',
			'LAURUSLABS',
			'NEULANDLAB',
			'AARTIDRUGS',
			'SOLARA',
			'GRANULES',
			'CONCORDBIO'
		]
	},
	{
		key: 'pharma_innovators_specialty',
		label: 'Pharma Innovators / Specialty',
		symbols: ['SUNPHARMA', 'ZYDUSLIFE', 'GLENMARK', 'CIPLA', 'DRREDDY']
	},
	{
		key: 'biosimilars',
		label: 'Biosimilars',
		symbols: ['BIOCON', 'DRREDDY', 'ZYDUSLIFE']
	},
	{
		key: 'hospitals',
		label: 'Hospitals',
		symbols: [
			'APOLLOHOSP',
			'MAXHEALTH',
			'FORTIS',
			'NH',
			'MEDANTA',
			'ASTERDM',
			'KIMS',
			'RAINBOW',
			'AGARWALEYE',
			'JLHL',
			'KOVAI'
		]
	},
	{
		key: 'diagnostics',
		label: 'Diagnostics',
		symbols: ['LALPATHLAB', 'METROPOLIS', 'VIJAYA', 'THYROCARE', 'KRSNAA', 'SURAKSHA']
	},
	{
		key: 'medical_devices',
		label: 'Medical Devices & Equipment',
		symbols: ['POLYMED', 'IKS']
	},

	// ---------- Sector 5: Capital Goods, Industrials & Defence ----------
	{
		key: 'defence_electronics',
		label: 'Defence Electronics',
		symbols: ['BEL', 'DATAPATTNS', 'ASTRAMICRO', 'ZENTEC', 'APOLLO', 'IDEAFORGE', 'PARAS', 'CENTUM']
	},
	{
		key: 'defence_platforms',
		label: 'Defence Platforms',
		symbols: [
			'HAL',
			'BDL',
			'MAZDOCK',
			'COCHINSHIP',
			'GRSE',
			'BEML',
			'SOLARINDS',
			'MIDHANI',
			'BHARATFORG',
			'DCXINDIA'
		]
	},
	{
		key: 'aero_raw_materials_metallurgy',
		label: 'Raw Materials & Aerospace-Grade Metallurgy',
		symbols: ['PTCIL', 'MIDHANI']
	},
	{
		key: 'aero_forgings_castings_precision',
		label: 'Forgings, Castings & Precision Machined Components',
		symbols: ['BHARATFORG', 'AZAD', 'UNIMECH', 'SANSERA']
	},
	{
		key: 'aero_aerostructures_airframe_assembly',
		label: 'Aerostructures, Airframe & Aircraft/Helicopter Assembly',
		symbols: ['HAL', 'AEQUS', 'DYNAMATECH']
	},
	{
		key: 'aero_avionics_radar_mission_electronics',
		label: 'Avionics, Radar & Mission Electronics',
		symbols: ['BEL', 'DATAPATTNS', 'ASTRAMICRO', 'CENTUM']
	},
	{
		key: 'aero_systems_integration_ems',
		label: 'Systems Integration & Aerospace/Defence EMS',
		symbols: ['CYIENTDLM', 'DCXINDIA', 'ROSSTECH', 'AXISCADES']
	},
	{
		key: 'aero_space_satellite_systems',
		label: 'Space & Satellite Systems',
		symbols: ['MTARTECH', 'PARAS']
	},
	{
		key: 'aero_drones_uav',
		label: 'Drones / UAV Systems',
		symbols: ['IDEAFORGE']
	},
	{
		key: 'aero_mro',
		label: 'MRO (Maintenance, Repair & Overhaul)',
		symbols: ['TANAA']
	},
	{
		key: 'grid_equipment',
		label: 'Power Transmission & Grid Equipment',
		symbols: [
			'TARIL',
			'GVT&D',
			'POWERINDIA',
			'ABB',
			'CGPOWER',
			'VOLTAMP',
			'BBL',
			'APARINDS',
			'KEC',
			'KPIL',
			'TRANSRAILL',
			'TDPOWERSYS'
		]
	},
	{
		key: 'wires_cables',
		label: 'Wires & Cables',
		symbols: ['POLYCAB', 'KEI', 'FINCABLES', 'APARINDS', 'UNIVCABLES']
	},
	{
		key: 'capital_goods_heavy_electrical',
		label: 'Capital Goods & Heavy Electrical',
		symbols: [
			'LT',
			'BHEL',
			'ABB',
			'SIEMENS',
			'CUMMINSIND',
			'THERMAX',
			'ELECON',
			'KSB',
			'GRINDWELL',
			'TIMKEN',
			'SKFINDIA'
		]
	},
	{
		key: 'precision_engineering',
		label: 'Precision Engineering',
		symbols: ['CRAFTSMAN', 'PRECAM', 'RKFORGE', 'MTARTECH', 'SUNDRMFAST', 'JTEKTINDIA']
	},
	{
		key: 'cnc_machine_tools',
		label: 'CNC Machines / Machine Tools',
		symbols: ['JYOTICNC']
	},
	{
		key: 'transformers_manufacturing',
		label: 'Transformers Manufacturing',
		symbols: [
			'TARIL',
			'SUPREMEPWR',
			'VOLTAMP',
			'ATLANTAELE',
			'SHILCTECH',
			'INDOTECH',
			'INDLMETER',
			'QPOWER',
			'POWERINDIA',
			'GVT&D',
			'ENRIN',
			'BHEL',
			'CGPOWER',
			'BBL',
			'PITTIENG',
			'KECL',
			'DIACABS',
			'MARSONS',
			'RTSPOWR'
		]
	},

	// ---------- Sector 6: Energy, Renewables & Power ----------
	{
		key: 'solar_manufacturing',
		label: 'Solar Manufacturing',
		symbols: [
			'WAAREEENER',
			'PREMIERENE',
			'WEBELSOLAR',
			'VIKRAMSOLR',
			'ALPEXSOLAR',
			'BORORENEW',
			'INA',
			'SAATVIKGL',
			'SOLEX',
			'ZODIAC'
		]
	},
	{
		key: 'renewable_ipp',
		label: 'Renewable Power Generation / IPPs',
		symbols: [
			'ADANIGREEN',
			'NTPCGREEN',
			'TATAPOWER',
			'JSWENERGY',
			'SUZLON',
			'INOXWIND',
			'WAAREERTL'
		]
	},
	{
		key: 'conventional_power',
		label: 'Conventional Power (Gen/T&D/Distribution)',
		symbols: [
			'NTPC',
			'ADANIPOWER',
			'NHPC',
			'SJVN',
			'POWERGRID',
			'ADANIENSOL',
			'CESC',
			'TORNTPOWER',
			'IEX'
		]
	},
	{
		key: 'oil_gas',
		label: 'Oil & Gas',
		symbols: [
			'ONGC',
			'OIL',
			'RELIANCE',
			'IOC',
			'BPCL',
			'HINDPETRO',
			'GAIL',
			'PETRONET',
			'GUJGASLTD',
			'MGL',
			'IGL'
		]
	},

	// ---------- Sector 7: Financials ----------
	{
		key: 'banks',
		label: 'Banks',
		symbols: [
			'HDFCBANK',
			'ICICIBANK',
			'AXISBANK',
			'KOTAKBANK',
			'INDUSINDBK',
			'SBIN',
			'BANKBARODA',
			'PNB',
			'CANBK',
			'AUBANK',
			'EQUITASBNK',
			'UJJIVANSFB'
		]
	},
	{
		key: 'nbfc_diversified_vehicle',
		label: 'NBFCs — Diversified / Vehicle Finance',
		symbols: ['BAJFINANCE', 'LTF', 'JIOFIN', 'SHRIRAMFIN', 'CHOLAFIN', 'M&MFIN', 'SUNDARMFIN']
	},
	{
		key: 'nbfc_housing',
		label: 'NBFCs — Housing Finance',
		symbols: [
			'BAJAJHFL',
			'LICHSGFIN',
			'PNBHOUSING',
			'AAVAS',
			'APTUS',
			'HOMEFIRST',
			'AADHARHFC',
			'CANFINHOME',
			'INDIASHLTR'
		]
	},
	{
		key: 'nbfc_gold_mfi',
		label: 'NBFCs — Gold Loans & Microfinance',
		symbols: ['MUTHOOTFIN', 'MANAPPURAM', 'IIFL', 'CREDITACC', 'FUSION', 'SPANDANA']
	},
	{
		key: 'insurance',
		label: 'Insurance',
		symbols: [
			'LICI',
			'SBILIFE',
			'HDFCLIFE',
			'ICICIPRULI',
			'MFSL',
			'ICICIGI',
			'GICRE',
			'NIACL',
			'STARHEALTH',
			'NIVABUPA',
			'GODIGIT'
		]
	},
	{
		key: 'capital_market_infra',
		label: 'Capital-Market Infrastructure',
		symbols: [
			'BSE',
			'MCX',
			'IEX',
			'CDSL',
			'CAMS',
			'KFINTECH',
			'HDFCAMC',
			'NAM-INDIA',
			'ABSLAMC',
			'UTIAMC',
			'ANGELONE',
			'MOTILALOFS',
			'NUVAMA',
			'360ONE',
			'ANANDRATHI',
			'IIFLCAPS',
			'CRISIL',
			'ICRA',
			'CARERATING'
		]
	},
	{
		key: 'fintech_platforms',
		label: 'Fintech (Payments / Lending / Wealthtech)',
		symbols: ['PAYTM', 'POLICYBZR', 'MOBIKWIK', 'ANGELONE']
	},

	// ---------- Sector 8: Chemicals ----------
	{
		key: 'specialty_chemicals',
		label: 'Specialty Chemicals',
		symbols: [
			'SRF',
			'NAVINFLUOR',
			'PIIND',
			'AARTIIND',
			'VINATIORGA',
			'FLUOROCHEM',
			'DEEPAKNTR',
			'ATUL',
			'JUBLINGREA',
			'TATVA',
			'ACI',
			'CHEMPLASTS'
		]
	},
	{
		key: 'agrochemicals',
		label: 'Agrochemicals',
		symbols: [
			'UPL',
			'PIIND',
			'COROMANDEL',
			'DHANUKA',
			'RALLIS',
			'INSECTICID',
			'AGREVOIND',
			'SHARDACROP'
		]
	},
	{
		key: 'commodity_petrochemicals',
		label: 'Commodity Chemicals & Petrochemicals',
		symbols: ['RELIANCE', 'GAIL', 'DEEPAKFERT', 'TATACHEM', 'GHCL', 'DCMSHRIRAM']
	},
	{
		key: 'paints_adhesives',
		label: 'Paints, Adhesives & Coatings',
		symbols: ['ASIANPAINT', 'BERGEPAINT', 'KANSAINER', 'PIDILITIND']
	},

	// ---------- Sector 9: Consumer ----------
	{
		key: 'fmcg',
		label: 'FMCG',
		symbols: [
			'HINDUNILVR',
			'ITC',
			'NESTLEIND',
			'BRITANNIA',
			'DABUR',
			'MARICO',
			'GODREJCP',
			'COLPAL',
			'TATACONSUM',
			'VBL'
		]
	},
	{
		key: 'discretionary_durables',
		label: 'Discretionary / Durables',
		symbols: [
			'TITAN',
			'HAVELLS',
			'CROMPTON',
			'VOLTAS',
			'BLUESTARCO',
			'WHIRLPOOL',
			'BAJAJELEC',
			'DIXON'
		]
	},
	{
		key: 'retail_qsr',
		label: 'Retail & QSR',
		symbols: [
			'DMART',
			'TRENT',
			'ABFRL',
			'MANYAVAR',
			'JUBLFOOD',
			'DEVYANI',
			'SAPPHIRE',
			'WESTLIFE',
			'RBA'
		]
	},
	{
		key: 'new_age_platforms',
		label: 'New-Age Consumer Platforms / Q-Commerce',
		symbols: [
			'ETERNAL',
			'SWIGGY',
			'NYKAA',
			'DELHIVERY',
			'CARTRADE',
			'IXIGO',
			'INDIAMART',
			'NAUKRI',
			'MAPMYINDIA',
			'HONASA'
		]
	},

	// ---------- Sector 10: Materials ----------
	{
		key: 'ferrous',
		label: 'Ferrous (Steel)',
		symbols: ['TATASTEEL', 'JSWSTEEL', 'SAIL', 'JINDALSTEL', 'APLAPOLLO', 'JSL']
	},
	{
		key: 'non_ferrous_mining',
		label: 'Non-Ferrous / Mining',
		symbols: ['HINDALCO', 'VEDL', 'HINDZINC', 'NATIONALUM', 'COALINDIA', 'NMDC']
	},
	{
		key: 'cement',
		label: 'Cement',
		symbols: [
			'ULTRACEMCO',
			'AMBUJACEM',
			'ACC',
			'SHREECEM',
			'DALBHARAT',
			'JKCEMENT',
			'RAMCOCEM',
			'NUVOCO'
		]
	},
	{
		key: 'building_materials',
		label: 'Building Materials',
		symbols: [
			'KAJARIACER',
			'SOMANYCERA',
			'SUPREMEIND',
			'ASTRAL',
			'FINPIPE',
			'PRINCEPIPE',
			'CERA',
			'CENTURYPLY',
			'GREENPANEL',
			'GREENLAM'
		]
	},

	// ---------- Sector 11: Infrastructure, Transport & Logistics ----------
	{
		key: 'roads_epc',
		label: 'Roads / EPC',
		symbols: ['LT', 'KNRCON', 'PNCINFRA', 'IRB', 'GRINFRA', 'ASHOKA']
	},
	{
		key: 'ports_logistics',
		label: 'Ports & Logistics',
		symbols: [
			'ADANIPORTS',
			'CONCOR',
			'DELHIVERY',
			'BLUEDART',
			'TCI',
			'VRLLOG',
			'MAHLOG',
			'ALLCARGO'
		]
	},
	{
		key: 'airports_aviation',
		label: 'Airports / Aviation',
		symbols: ['GMRAIRPORT', 'INDIGO', 'SPICEJET']
	},
	{
		key: 'railways',
		label: 'Railways',
		symbols: ['TITAGARH', 'JWL', 'TEXRAIL', 'RVNL', 'IRCON', 'IRCTC', 'IRFC', 'HBLENGINE']
	},

	// ---------- Sector 12: Real Estate, Telecom, Textiles, Agri ----------
	{
		key: 'real_estate_reits',
		label: 'Real Estate / REITs',
		symbols: [
			'DLF',
			'GODREJPROP',
			'OBEROIRLTY',
			'LODHA',
			'PRESTIGE',
			'PHOENIXLTD',
			'EMBASSY',
			'MINDSPACE',
			'BIRET',
			'NXST'
		]
	},
	{
		key: 'telecom',
		label: 'Telecom',
		symbols: ['BHARTIARTL', 'IDEA', 'TATACOMM', 'INDUSTOWER']
	},
	{
		key: 'textiles',
		label: 'Textiles',
		symbols: ['PAGEIND', 'KPRMILL', 'TRIDENT', 'WELSPUNLIV', 'VTL', 'ARVIND', 'GOKEX', 'RAYMOND']
	},
	{
		key: 'agri_inputs_fertilizers',
		label: 'Agri Inputs & Fertilizers',
		symbols: [
			'COROMANDEL',
			'CHAMBLFERT',
			'DEEPAKFERT',
			'GNFC',
			'RCF',
			'NFL',
			'KSCL',
			'ESCORTS',
			'VSTTILLERS'
		]
	},

	// ---------- Sector: Metal & E-Waste Recycling ----------
	// Parmeshwar Metal (Copper Scrap Recycling) is excluded here — its NSE_Symbol was given as
	// "Not on NSE" with no usable ticker at all (unlike e.g. SPEL, which at least has a plausible
	// symbol), and this app's data pipeline is NSE-only via Angel One.
	{
		key: 'recycling_scrap_infra',
		label: 'Scrap Collection, Trading & Auction Infrastructure',
		symbols: ['MSTCLTD']
	},
	{
		key: 'recycling_lead_battery',
		label: 'Lead & Battery-Scrap Recycling (Secondary Lead Smelting)',
		symbols: ['POCL', 'JAINREC', 'ARDEE']
	},
	{
		key: 'recycling_aluminium_scrap',
		label: 'Aluminium Scrap Recycling (Ingots & Alloys)',
		symbols: ['BAHETI']
	},
	{
		key: 'recycling_copper_scrap',
		label: 'Copper Scrap Recycling (Wire Rods & Conductors)',
		symbols: ['SUNLITE']
	},
	{
		key: 'recycling_multimetal_global',
		label: 'Integrated Multi-Metal & Global Recycling',
		symbols: ['GRAVITA', 'CMRGREEN']
	},
	{
		key: 'recycling_ewaste_recovery',
		label: 'E-waste / WEEE & Precious-Industrial Metal Recovery',
		symbols: ['ECORECO', 'NAMOEWASTE']
	},

	// ---------- Sector: Nuclear Power / SMR ----------
	{
		key: 'nuclear_power_smr',
		label: 'Nuclear Power / SMR',
		symbols: ['BHEL', 'LT', 'NTPC', 'MTARTECH', 'WALCHANNAG', 'ENGINERSIN']
	},

	// ---------- Sector: Tourism, Hospitality & Travel ----------
	{
		key: 'hotels_hospitality',
		label: 'Hotels & Hospitality',
		symbols: ['INDHOTEL', 'EIHOTEL', 'LEMONTREE', 'CHALET', 'PARKHOTELS', 'ITCHOTELS']
	},
	{
		key: 'travel_booking_ota',
		label: 'Travel Booking & OTAs',
		symbols: ['EASEMYTRIP', 'IRCTC']
	},

	// ---------- Sector: Gaming, Esports & AVGC ----------
	{
		key: 'gaming_esports_avgc',
		label: 'Gaming, Esports & AVGC',
		symbols: ['NAZARA', 'DELTACORP', 'ONMOBILE']
	},

	// ---------- Sector: Gems & Jewellery ----------
	{
		key: 'gems_jewellery_retail',
		label: 'Gems & Jewellery Retail',
		symbols: [
			'TITAN',
			'KALYANKJIL',
			'PCJEWELLER',
			'SENCO',
			'THANGAMAYL',
			'VAIBHAVGBL',
			'GOLDIAM',
			'RAJESHEXPO'
		]
	},

	// ---------- New subsector inside the existing Automobile & EV Value Chain major sector ----------
	{
		key: 'ev_charging_infra',
		label: 'EV Charging Infrastructure',
		symbols: ['ABB', 'SIEMENS', 'SCHNEIDER', 'EXIDEIND', 'HBLENGINE', 'ARE&M', 'TATAPOWER', 'JBMA']
	},

	// ---------- New subsector inside the existing Renewable Energy major sector ----------
	{
		key: 'green_hydrogen',
		label: 'Green Hydrogen',
		symbols: ['RELIANCE', 'LT', 'NTPC', 'GAIL', 'BPCL', 'ADANIGREEN', 'WAAREEENER']
	},

	// ---------- New subsector inside the existing Materials & Mining major sector ----------
	{
		key: 'critical_minerals_rare_earths',
		label: 'Critical Minerals & Rare Earths',
		symbols: ['GMDCLTD', 'NMDC', 'MOIL', 'HINDZINC', 'HINDCOPPER', 'NATIONALUM', 'VEDL', 'IMFA']
	},

	// ---------- New subsector inside the existing Infrastructure, Transport & Logistics major sector ----------
	{
		key: 'commercial_shipping_maritime',
		label: 'Commercial Shipping / Maritime',
		symbols: ['GESHIP', 'SCI']
	}
];

/**
 * The third, top-level layer for Sector Rotation: broad major sectors, each a rollup of one or
 * more of the CUSTOM_SECTORS baskets above (referenced here by key, not duplicated). This is a
 * deliberately finer-grained re-carving of the old 12 loose comment-groups above — split
 * wherever the underlying businesses aren't really the same value chain (e.g. Data Center
 * infra/cooling/networking/AI-compute pulled out of the old "IT, AI & Digital Infrastructure"
 * catch-all; Banking split from NBFCs/Insurance/Capital Markets; the old leftover "Real
 * Estate/Telecom/Textiles/Agri" bucket split into four unrelated major sectors) rather than
 * force-merged for the sake of fewer top-level cards. Several are intentionally
 * single-subsector major sectors (Banking, Insurance, Telecom, Real Estate, Textiles,
 * Agriculture & Fertilizers, IT Services & Software) because nothing else genuinely belongs
 * with them today — each still rolls up correctly and can gain siblings later by editing this
 * list alone.
 */
export interface MajorSector {
	key: string;
	label: string;
	subsectorKeys: string[];
}

export const MAJOR_SECTORS: MajorSector[] = [
	{
		key: 'data_center_digital_infra',
		label: 'Data Center & Digital Infrastructure',
		subsectorKeys: [
			'dc_land_powered_shell',
			'dc_power_gen_transmission_grid',
			'dc_electrical_equipment_distribution',
			'dc_backup_power',
			'dc_cables_connectivity',
			'dc_cooling_thermal',
			'dc_construction_mep',
			'ai_compute_servers_gpu',
			'dc_it_hardware_distribution',
			'dc_colocation_hyperscale_operators',
			'dc_connectivity_subsea'
		]
	},
	{
		key: 'it_services_software',
		label: 'IT Services & Software',
		subsectorKeys: ['it_services_saas']
	},
	{
		key: 'semiconductors_electronics',
		label: 'Semiconductors & Electronics Manufacturing',
		subsectorKeys: [
			'chip_design_ip',
			'semicon_gases',
			'semicon_chemicals',
			'semicon_fluoropolymers',
			'semicon_ultrapure_water',
			'semicon_cleanroom',
			'semicon_fab_equipment',
			'semicon_fabrication_foundries',
			'osat_atmp',
			'ems_system_integration',
			'power_semiconductors_discretes',
			'semiconductor_distribution'
		]
	},
	{
		key: 'auto_ev_value_chain',
		label: 'Automobile & EV Value Chain',
		subsectorKeys: [
			'ev_cells_batteries',
			'ev_powertrain',
			'ev_auto_oems',
			'traditional_auto_components',
			'ev_charging_infra'
		]
	},
	{
		key: 'pharma_life_sciences',
		label: 'Pharmaceuticals & Life Sciences',
		subsectorKeys: ['cdmo_crdmo', 'pharma_apis', 'pharma_innovators_specialty', 'biosimilars']
	},
	{
		key: 'healthcare_delivery_medtech',
		label: 'Healthcare Delivery & MedTech',
		subsectorKeys: ['hospitals', 'diagnostics', 'medical_devices']
	},
	{
		key: 'defence_major',
		label: 'Defence',
		// aero_systems_integration_ems and aero_mro are deliberately also listed under Aerospace
		// below — both baskets are explicitly dual-purpose per their own descriptions ("Aerospace/
		// Defence EMS", MRO serving "military and commercial" aircraft), not a single-industry
		// basket that happens to get reused. A subsector can validly belong to more than one
		// major sector; only individual CUSTOM_SECTORS baskets need to stay unique.
		subsectorKeys: [
			'defence_electronics',
			'defence_platforms',
			'aero_systems_integration_ems',
			'aero_mro'
		]
	},
	{
		key: 'aerospace_major',
		label: 'Aerospace',
		subsectorKeys: [
			'aero_raw_materials_metallurgy',
			'aero_forgings_castings_precision',
			'aero_aerostructures_airframe_assembly',
			'aero_avionics_radar_mission_electronics',
			'aero_systems_integration_ems',
			'aero_space_satellite_systems',
			'aero_drones_uav',
			'aero_mro'
		]
	},
	{
		key: 'capital_goods_industrials',
		label: 'Capital Goods & Industrials',
		subsectorKeys: [
			'wires_cables',
			'capital_goods_heavy_electrical',
			'precision_engineering',
			'cnc_machine_tools'
		]
	},
	{
		key: 'renewable_energy',
		label: 'Renewable Energy',
		subsectorKeys: ['solar_manufacturing', 'renewable_ipp', 'green_hydrogen']
	},
	{
		key: 'conventional_energy',
		label: 'Conventional Energy (Power, Oil & Gas)',
		// grid_equipment and transformers_manufacturing are T&D/grid-hardware manufacturers, not
		// power generators/utilities themselves — grouped here anyway per explicit user call: the
		// end-market (power sector capex) outweighs the business-model distinction (equipment
		// maker vs. utility) for this taxonomy.
		subsectorKeys: ['conventional_power', 'oil_gas', 'grid_equipment', 'transformers_manufacturing']
	},
	{
		key: 'banking',
		label: 'Banking',
		subsectorKeys: ['banks']
	},
	{
		key: 'nbfc_lending',
		label: 'NBFCs & Lending',
		subsectorKeys: ['nbfc_diversified_vehicle', 'nbfc_housing', 'nbfc_gold_mfi']
	},
	{
		key: 'insurance_major',
		label: 'Insurance',
		subsectorKeys: ['insurance']
	},
	{
		key: 'capital_markets_fintech',
		label: 'Capital Markets & Fintech',
		subsectorKeys: ['capital_market_infra', 'fintech_platforms']
	},
	{
		key: 'chemicals_major',
		label: 'Chemicals',
		subsectorKeys: [
			'specialty_chemicals',
			'agrochemicals',
			'commodity_petrochemicals',
			'paints_adhesives'
		]
	},
	{
		key: 'consumer_major',
		label: 'Consumer',
		subsectorKeys: ['fmcg', 'discretionary_durables', 'retail_qsr', 'new_age_platforms']
	},
	{
		key: 'materials_mining',
		label: 'Materials & Mining',
		subsectorKeys: [
			'ferrous',
			'non_ferrous_mining',
			'cement',
			'building_materials',
			'critical_minerals_rare_earths'
		]
	},
	{
		key: 'infra_transport_logistics',
		label: 'Infrastructure, Transport & Logistics',
		subsectorKeys: [
			'roads_epc',
			'ports_logistics',
			'airports_aviation',
			'railways',
			'commercial_shipping_maritime'
		]
	},
	{
		key: 'real_estate_major',
		label: 'Real Estate',
		subsectorKeys: ['real_estate_reits']
	},
	{
		key: 'telecom_major',
		label: 'Telecom',
		subsectorKeys: ['telecom']
	},
	{
		key: 'textiles_major',
		label: 'Textiles',
		subsectorKeys: ['textiles']
	},
	{
		key: 'agriculture_fertilizers',
		label: 'Agriculture & Fertilizers',
		subsectorKeys: ['agri_inputs_fertilizers']
	},
	{
		key: 'metal_ewaste_recycling',
		label: 'Metal & E-Waste Recycling',
		subsectorKeys: [
			'recycling_scrap_infra',
			'recycling_lead_battery',
			'recycling_aluminium_scrap',
			'recycling_copper_scrap',
			'recycling_multimetal_global',
			'recycling_ewaste_recovery'
		]
	},
	{
		key: 'nuclear_power_major',
		label: 'Nuclear Power / SMR',
		subsectorKeys: ['nuclear_power_smr']
	},
	{
		key: 'tourism_hospitality_travel',
		label: 'Tourism, Hospitality & Travel',
		subsectorKeys: ['hotels_hospitality', 'travel_booking_ota']
	},
	{
		key: 'gaming_esports_major',
		label: 'Gaming, Esports & AVGC',
		subsectorKeys: ['gaming_esports_avgc']
	},
	{
		key: 'gems_jewellery_major',
		label: 'Gems & Jewellery',
		subsectorKeys: ['gems_jewellery_retail']
	}
];
