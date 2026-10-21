# Sector taxonomy v2 notes

## Method
The universe is research/companies_mcap_above_500cr.csv (1,833 companies).
Baskets were authored by hand from knowledge of each company business, reading every company name in the universe, and starting from the existing 99 baskets.
Every symbol was then checked mechanically against the universe CSV (nse_symbol, else bse_code) or the existing basket symbols.
research/universe_industry_classification.csv holds the official NSE 4-level classification (macro, sector, industry, basic industry) read from the Screener peers breadcrumb for 1,820 of the 1,833 universe rows.
The reproducible checker research/check_taxonomy_v2.js reads it with the taxonomy JSON and, per basket, lists members whose basic industry disagrees with the basket dominant industries and unplaced universe names in those industries.
Business knowledge wins for thematic baskets, so the classification was used to complete baskets and to place unplaced names, not to override themes.
Web research beyond that was not done: a Screener peer-comparison probe returned no peer rows (the table loads via AJAX).
Treat constituent lists as a strong first draft that needs a review pass, especially the micro-cap names flagged in the caveats.
Basket floor: 3 genuine names for niche baskets and 5 or more preferred. Niche baskets that could not reach 3 genuine names were merged into their nearest sibling and the old key listed in the retired array.
Thematic baskets (data centre colocation, green hydrogen, EV charging) prefer pure plays. Megacap conglomerates appear only as secondary members, with LT kept in green_hydrogen for electrolyser manufacturing.
Primary basket rule: the first basket (in file order) that lists a symbol without the secondary marker is its primary.
Secondary memberships are limited to genuine dual themes (data centre supply chain, EV charging, nuclear, green hydrogen, watches).

## Symbols for BSE-only companies
The JSON uses the id exactly as the universe has it: nse_symbol when present, otherwise the bse_code value (for example NSDL, CCAVENUE, TANFACIND, GHVINFRA).
13 universe rows have neither value (no price source) and cannot be placed: J.B. Chemicals & Pharmaceuticals Lt; Gujarat State Petronet Ltd.; Midwest Gold Ltd; Cigniti Technologies Ltd; LS Industries Limited; Citurgia Biochemicals Ltd.; Sanghi Industries Ltd.; AVISHKAR INFRA REALTY LIMITED; Haryana Financial Corporation ltd.; Pine Animation Limited; Orissa Sponge Iron And Steel Limited; MAAGH ADVERTISING AND MARKETING SERVICES LIMITED; Maa Jagdambe Tradelinks Limited.

## Coverage
- Majors: 33 (old: 28)
- Baskets: 196 (old: 97)
- Distinct stocks in baskets: 1823 (1808 in the universe, 15 kept from old baskets only)
- Universe placed: 1808 of 1833 = 98.6%
- Smallest basket: 3 names; baskets below 5: 12 (all genuine niches with 3 or 4 names)
- Retired array in the JSON: 14 keys (banks, insurance, it_services_saas and nbfc_diversified_vehicle were split into finer baskets; the rest were merged for being too thin).

## Per-basket counts

| Major | Basket key | Names | Primary |
|---|---|---|---|
| banking | banks_private | 19 | 19 |
| banking | banks_psu | 13 | 13 |
| banking | banks_small_finance | 8 | 8 |
| nbfc_lending | nbfc_diversified | 21 | 21 |
| nbfc_lending | nbfc_vehicle_finance | 6 | 6 |
| nbfc_lending | nbfc_housing | 11 | 11 |
| nbfc_lending | nbfc_gold_mfi | 9 | 9 |
| nbfc_lending | nbfc_sme_lending | 12 | 12 |
| nbfc_lending | infra_finance_psu | 8 | 8 |
| insurance_major | insurance_life | 6 | 6 |
| insurance_major | insurance_general_health | 7 | 7 |
| capital_markets_fintech | capital_market_infra | 12 | 12 |
| capital_markets_fintech | amcs_wealth | 13 | 13 |
| capital_markets_fintech | brokers_investment_banks | 29 | 29 |
| capital_markets_fintech | fintech_platforms | 12 | 12 |
| capital_markets_fintech | holding_investment_cos | 46 | 46 |
| it_services_software | it_services_large | 10 | 10 |
| it_services_software | it_services_midsmall | 28 | 28 |
| it_services_software | it_er_d | 10 | 10 |
| it_services_software | it_software_products | 18 | 18 |
| it_services_software | bpo_analytics_ai | 13 | 13 |
| it_services_software | it_hardware_si | 16 | 16 |
| internet_platforms | new_age_platforms | 11 | 11 |
| internet_platforms | internet_classifieds | 10 | 10 |
| internet_platforms | edtech_education | 11 | 11 |
| data_center_digital_infra | dc_colocation_hyperscale_operators | 5 | 1 |
| data_center_digital_infra | ai_compute_servers_gpu | 6 | 0 |
| data_center_digital_infra | dc_cooling_thermal | 9 | 3 |
| data_center_digital_infra | dc_cables_connectivity | 8 | 0 |
| data_center_digital_infra | dc_backup_power | 5 | 0 |
| data_center_digital_infra | dc_electrical_equipment_distribution | 9 | 0 |
| data_center_digital_infra | dc_power_gen_transmission_grid | 7 | 0 |
| data_center_digital_infra | dc_connectivity_subsea | 3 | 0 |
| data_center_digital_infra | dc_it_hardware_distribution | 4 | 0 |
| data_center_digital_infra | dc_construction_mep | 5 | 0 |
| semiconductors_electronics | ems_system_integration | 17 | 17 |
| semiconductors_electronics | osat_atmp | 6 | 4 |
| semiconductors_electronics | semicon_chemicals | 8 | 2 |
| semiconductors_electronics | chip_design_ip | 9 | 0 |
| semiconductors_electronics | semicon_ultrapure_water | 3 | 0 |
| semiconductors_electronics | power_semiconductors_discretes | 4 | 2 |
| semiconductors_electronics | semicon_fab_equipment_cleanroom | 3 | 3 |
| semiconductors_electronics | semicon_fluoropolymers | 5 | 1 |
| telecom_major | telecom | 8 | 8 |
| telecom_major | telecom_equipment_towers | 14 | 14 |
| pharma_life_sciences | pharma_innovators_specialty | 11 | 11 |
| pharma_life_sciences | pharma_domestic_branded | 15 | 15 |
| pharma_life_sciences | pharma_mnc_india | 7 | 7 |
| pharma_life_sciences | pharma_generics_exporters | 26 | 26 |
| pharma_life_sciences | cdmo_crdmo | 16 | 15 |
| pharma_life_sciences | pharma_apis | 25 | 21 |
| pharma_life_sciences | biosimilars | 10 | 8 |
| healthcare_delivery_medtech | hospitals | 19 | 19 |
| healthcare_delivery_medtech | specialty_care_chains | 5 | 5 |
| healthcare_delivery_medtech | diagnostics | 7 | 7 |
| healthcare_delivery_medtech | medical_devices | 6 | 6 |
| healthcare_delivery_medtech | healthcare_distribution_services | 5 | 4 |
| chemicals_major | chem_fluoro | 6 | 5 |
| chemicals_major | specialty_chemicals | 26 | 26 |
| chemicals_major | chem_amines_intermediates | 10 | 10 |
| chemicals_major | chem_dyes_pigments | 11 | 11 |
| chemicals_major | chem_oleo_surfactants_flavours | 9 | 9 |
| chemicals_major | chem_carbon_rubber_polymers | 11 | 11 |
| chemicals_major | chem_chlor_alkali_inorganics | 13 | 13 |
| chemicals_major | commodity_petrochemicals | 12 | 12 |
| chemicals_major | paints_adhesives | 9 | 9 |
| chemicals_major | agrochemicals | 21 | 21 |
| chemicals_major | agri_inputs_fertilizers | 12 | 12 |
| conventional_energy | oil_gas | 10 | 9 |
| conventional_energy | oil_gas_upstream | 12 | 12 |
| conventional_energy | city_gas_distribution | 5 | 5 |
| conventional_energy | lubricants_specialty_oils | 6 | 6 |
| conventional_energy | coal_mining_services | 7 | 7 |
| power_utilities_equipment | conventional_power | 14 | 14 |
| power_utilities_equipment | power_t_d_utilities | 7 | 7 |
| power_utilities_equipment | grid_equipment | 12 | 12 |
| power_utilities_equipment | transformers_manufacturing | 12 | 12 |
| power_utilities_equipment | power_t_d_epc_towers | 11 | 11 |
| power_utilities_equipment | industrial_automation_electricals | 13 | 13 |
| renewable_energy | renewable_ipp | 11 | 9 |
| renewable_energy | solar_manufacturing | 17 | 17 |
| renewable_energy | solar_epc_rooftop | 10 | 10 |
| renewable_energy | wind_energy | 6 | 4 |
| renewable_energy | ev_cells_batteries | 6 | 6 |
| renewable_energy | green_hydrogen | 6 | 1 |
| capital_goods_industrials | capital_goods_heavy_electrical | 16 | 15 |
| capital_goods_industrials | industrial_pumps_compressors_engines | 13 | 13 |
| capital_goods_industrials | material_handling_construction_equipment | 6 | 6 |
| capital_goods_industrials | cnc_machine_tools | 13 | 13 |
| capital_goods_industrials | bearings_transmission | 9 | 9 |
| capital_goods_industrials | abrasives_refractories_consumables | 12 | 12 |
| capital_goods_industrials | precision_engineering | 13 | 13 |
| capital_goods_industrials | wires_cables | 17 | 16 |
| capital_goods_industrials | steel_pipes_tubes | 19 | 19 |
| capital_goods_industrials | plastic_pipes | 7 | 7 |
| capital_goods_industrials | water_waste_environment | 9 | 9 |
| capital_goods_industrials | railways | 9 | 8 |
| capital_goods_industrials | railways_psu_epc | 6 | 5 |
| capital_goods_industrials | roads_epc | 12 | 12 |
| capital_goods_industrials | infra_epc_diversified | 27 | 26 |
| auto_ev_value_chain | auto_pv_dealers | 6 | 6 |
| auto_ev_value_chain | auto_2w_oems | 7 | 7 |
| auto_ev_value_chain | auto_cv_3w_oems | 6 | 6 |
| auto_ev_value_chain | tractors_farm_equipment | 6 | 6 |
| auto_ev_value_chain | ev_auto_oems | 9 | 5 |
| auto_ev_value_chain | auto_tyres | 8 | 8 |
| auto_ev_value_chain | traditional_auto_components | 21 | 21 |
| auto_ev_value_chain | auto_comp_engine_drivetrain | 13 | 12 |
| auto_ev_value_chain | auto_comp_chassis_brakes_wheels | 16 | 15 |
| auto_ev_value_chain | auto_comp_electrical_lighting | 10 | 10 |
| auto_ev_value_chain | ev_powertrain | 6 | 1 |
| auto_ev_value_chain | auto_forgings | 11 | 11 |
| auto_ev_value_chain | auto_castings | 11 | 11 |
| auto_ev_value_chain | ev_charging_infra | 6 | 0 |
| consumer_major | fmcg | 7 | 7 |
| consumer_major | fmcg_hpc | 14 | 14 |
| consumer_major | packaged_foods_snacks | 16 | 14 |
| consumer_major | dairy_ice_cream | 7 | 7 |
| consumer_major | beverages_tea_coffee | 6 | 6 |
| consumer_major | alco_bev | 16 | 16 |
| consumer_major | sugar_ethanol | 19 | 18 |
| consumer_major | agri_commodities_oils_grains | 16 | 16 |
| consumer_major | poultry_aqua_feed | 11 | 11 |
| consumer_major | food_ingredients | 12 | 7 |
| consumer_major | discretionary_durables | 11 | 9 |
| consumer_major | electricals_fans_lighting | 8 | 8 |
| consumer_major | kitchenware_housewares | 5 | 5 |
| consumer_major | home_furnishing_furniture | 6 | 5 |
| consumer_major | watches_luggage_accessories | 7 | 6 |
| consumer_major | retail_value_departmental | 9 | 9 |
| consumer_major | apparel_brands_fashion_retail | 14 | 14 |
| consumer_major | innerwear_basics | 5 | 5 |
| consumer_major | footwear | 6 | 6 |
| consumer_major | retail_qsr | 9 | 9 |
| consumer_major | stationery_writing | 6 | 4 |
| media_entertainment | media_tv_cable | 12 | 12 |
| media_entertainment | media_print_radio_outdoor | 10 | 10 |
| media_entertainment | media_content_music_vfx | 7 | 7 |
| media_entertainment | leisure_parks_cinemas | 5 | 4 |
| tourism_hospitality_travel | hotels_hospitality | 12 | 12 |
| tourism_hospitality_travel | hotels_regional_small | 11 | 11 |
| tourism_hospitality_travel | travel_booking_ota | 8 | 6 |
| tourism_hospitality_travel | airports_aviation | 4 | 3 |
| infra_transport_logistics | ports_logistics | 6 | 6 |
| infra_transport_logistics | logistics_cfs_container | 8 | 7 |
| infra_transport_logistics | logistics_express_3pl | 9 | 9 |
| infra_transport_logistics | logistics_road_freight | 6 | 5 |
| infra_transport_logistics | commercial_shipping_maritime | 6 | 4 |
| business_services | staffing_facility_services | 11 | 11 |
| real_estate_major | resi_developers_large | 16 | 16 |
| real_estate_major | resi_developers_midsmall | 41 | 41 |
| real_estate_major | real_estate_reits | 11 | 11 |
| materials_mining | ferrous | 7 | 7 |
| materials_mining | steel_long_sponge | 16 | 15 |
| materials_mining | steel_stainless_special | 9 | 9 |
| materials_mining | ferro_alloys_graphite | 6 | 6 |
| materials_mining | non_ferrous_mining | 8 | 8 |
| materials_mining | critical_minerals_rare_earths | 12 | 12 |
| materials_mining | psu_diversified_trading | 6 | 5 |
| materials_mining | cement | 8 | 8 |
| materials_mining | cement_south | 8 | 8 |
| materials_mining | cement_regional_midsmall | 8 | 8 |
| materials_mining | tiles_sanitaryware | 9 | 9 |
| materials_mining | wood_panels_laminates | 6 | 6 |
| materials_mining | building_materials | 13 | 13 |
| materials_mining | paper_pulp | 10 | 10 |
| materials_mining | packaging_flexible_films | 11 | 11 |
| materials_mining | packaging_rigid_industrial | 11 | 10 |
| textiles_major | home_textiles | 7 | 7 |
| textiles_major | textiles | 18 | 18 |
| textiles_major | textiles_synthetic_fibres | 7 | 6 |
| textiles_major | textiles_fabrics_denim | 11 | 11 |
| textiles_major | garments_exporters | 7 | 7 |
| textiles_major | textile_technical_jute | 6 | 6 |
| defence_major | defence_platforms | 5 | 3 |
| defence_major | defence_shipbuilding | 5 | 4 |
| defence_major | defence_electronics | 10 | 9 |
| defence_major | defence_ammunition_explosives | 8 | 8 |
| defence_major | aero_systems_integration_ems | 7 | 2 |
| aerospace_major | aero_forgings_castings_precision | 6 | 2 |
| aerospace_major | aero_space_satellite_systems | 5 | 0 |
| aerospace_major | aero_raw_materials_metallurgy | 3 | 0 |
| aerospace_major | aero_aerostructures_airframe_assembly | 5 | 3 |
| aerospace_major | aero_avionics_radar_mission_electronics | 6 | 0 |
| aerospace_major | aero_drones_uav | 7 | 0 |
| conglomerates_diversified | conglomerates_diversified | 13 | 13 |
| metal_ewaste_recycling | recycling_ewaste_recovery | 3 | 2 |
| metal_ewaste_recycling | recycling_aluminium_scrap | 3 | 1 |
| metal_ewaste_recycling | recycling_lead_battery | 4 | 4 |
| metal_ewaste_recycling | recycling_plastics_rubber | 3 | 1 |
| metal_ewaste_recycling | recycling_multimetal_global | 4 | 4 |
| glass | industrial_toughened_glass | 9 | 8 |
| gems_jewellery_major | gems_jewellery_retail | 17 | 17 |
| gems_jewellery_major | jewellery_manufacturers_exporters | 11 | 11 |
| gaming_esports_major | gaming_esports_avgc | 5 | 4 |
| nuclear_power_major | nuclear_power_smr | 7 | 2 |

## Unplaced universe companies
12 companies (0.7%) are not in any basket, plus the 13 rows without a symbol.
Reasons: obscure micro-caps (EBIX is ambiguous: the universe name is Eraaya Lifespaces but Screener still classifies it as 2/3 wheelers, so it was removed from developers and left unplaced), shells or trading companies whose business could not be identified with confidence, and single-asset names with no peer group of 5.
List (symbol|name):
- KALIND|Kalind Limited
- A1L|A-1 LIMITED
- YSL|The Yamuna Syndicate Ltd
- PERVASIVE|Pervasive Commodities Limited
- SOBME|Sobhagya Mercantile Ltd.
- CWD|CWD Limited
- FABTECH|Fabtech Technologies Limited
- PQIF|Polo Queen Industrial and Fintech Limited
- SMTEL|SMT ENGINEERING LIMITED
- IIRM|IIRM HOLDINGS INDIA LIMITED
- EBIX|ERAAYA LIFESPACES LIMITED
- BMWVENTLTD|BMW VENTURES LIMITED

## Key changes versus the old taxonomy
Kept keys (84): dc_power_gen_transmission_grid, dc_electrical_equipment_distribution, dc_backup_power, dc_cables_connectivity, dc_cooling_thermal, dc_construction_mep, ai_compute_servers_gpu, dc_it_hardware_distribution, dc_colocation_hyperscale_operators, dc_connectivity_subsea, chip_design_ip, semicon_chemicals, semicon_fluoropolymers, semicon_ultrapure_water, osat_atmp, ems_system_integration, power_semiconductors_discretes, ev_cells_batteries, ev_powertrain, ev_auto_oems, traditional_auto_components, ev_charging_infra, cdmo_crdmo, pharma_apis, pharma_innovators_specialty, biosimilars, hospitals, diagnostics, medical_devices, defence_electronics, defence_platforms, aero_systems_integration_ems, aero_raw_materials_metallurgy, aero_forgings_castings_precision, aero_aerostructures_airframe_assembly, aero_avionics_radar_mission_electronics, aero_space_satellite_systems, aero_drones_uav, wires_cables, capital_goods_heavy_electrical, precision_engineering, cnc_machine_tools, solar_manufacturing, renewable_ipp, green_hydrogen, conventional_power, oil_gas, grid_equipment, transformers_manufacturing, nbfc_housing, nbfc_gold_mfi, capital_market_infra, fintech_platforms, specialty_chemicals, agrochemicals, commodity_petrochemicals, paints_adhesives, fmcg, discretionary_durables, retail_qsr, new_age_platforms, ferrous, non_ferrous_mining, cement, building_materials, critical_minerals_rare_earths, roads_epc, ports_logistics, airports_aviation, railways, commercial_shipping_maritime, real_estate_reits, telecom, textiles, agri_inputs_fertilizers, recycling_lead_battery, recycling_aluminium_scrap, recycling_multimetal_global, recycling_ewaste_recovery, nuclear_power_smr, hotels_hospitality, travel_booking_ota, gaming_esports_avgc, gems_jewellery_retail.
Retired keys (13) and where the concept went:
- dc_land_powered_shell: retired, under 3 genuine names; merged into dc_construction_mep (LODHA, ANANTRAJ secondary)
- it_services_saas: split into it_services_large, it_services_midsmall, it_er_d, it_software_products
- semicon_gases: retired, 2 names (LINDEINDIA, ELLEN); merged into semicon_chemicals
- semicon_cleanroom: retired, 2 names; merged into semicon_fab_equipment_cleanroom
- semicon_fab_equipment: retired, 1 name; merged with cleanroom into semicon_fab_equipment_cleanroom
- semicon_fabrication_foundries: retired, no listed Indian fab; RIR moved to power_semiconductors_discretes, VEDL left in non_ferrous_mining
- semiconductor_distribution: retired, only 2 names and both already in dc_it_hardware_distribution
- aero_mro: retired, under 3 genuine names; HAL and TANAA sit in aero_aerostructures_airframe_assembly
- banks: split into banks_private, banks_psu, banks_small_finance
- nbfc_diversified_vehicle: split into nbfc_diversified and nbfc_vehicle_finance
- insurance: split into insurance_life and insurance_general_health
- recycling_scrap_infra: retired, 1 name; MSTCLTD moved to recycling_multimetal_global
- recycling_copper_scrap: retired, 1 name; SUNLITE moved to recycling_multimetal_global
- solar_glass: retired, 1 name; BORORENEW is already in solar_manufacturing (key was in the live database, not in the seed file)
Retired majors: agriculture_fertilizers.
New majors: internet_platforms, power_utilities_equipment, media_entertainment, business_services, conglomerates_diversified, glass.

## Checker summary
First run on the full classification: 427 member disagreements across 196 baskets and 168 unplaced-in-dominant-industry hits (many repeats of the same few names).
After the fixes below: 416 member disagreements (nearly all documented as kept) and 15 unplaced-in-dominant-industry hits (trading shells and the ambiguous names listed below).
Resolved by moving the member: LINC (stationery only), PHOENIXLTD (to real_estate_reits as a mall and retail asset owner), GEECEE (to resi_developers_midsmall), TANAA (primary in aero_aerostructures_airframe_assembly), GARUDA (infra_epc_diversified), DHENUBUILD (nbfc_diversified), INDIAHOMES (steel_long_sponge), BGDL (it_hardware_si), TREL (logistics_cfs_container), AURUM (new_age_platforms), EBIX (unplaced).
Resolved by placing 36 previously unplaced names by industry, for example KESAR, GEECEE, DPSCLTD, JOJO, AQYLON, KSSMART, AXISOL, HARDWYN, EXCELINDUS, REGAAL, SHINDL, HIIL, NEUEON.
Kept as documented disagreements because business knowledge beats the label: IDBI in banks_psu (government owned, bank classified private); holding companies whose label is their legacy operating business (KIRLOSIND, JAICORPLTD, ZUARIIND, DVL, ISTLTD, KOTIC, ALEMBICLTD, PTL, RPSGVENT, GFLLIMITED, OSWALAGRO); real estate land owners labelled by parent (TEXINFRA, BLAL, OSWALGREEN, TCC, MCCHRLS-B, HEMIPROP); data centre builders labelled civil construction (TECHNOE); thematic dual-industry names (LT, RAILTEL, TATACOMM, SIKA, MTARTECH, CGPOWER, KAYNES); and NBFC baskets with Holding Company or Housing Finance labels (BAJAJFINSV, EDELWEISS, PIRAMALFIN).
Left unplaced on purpose (trading shells or ambiguous business): KALIND, SOBME, A1L, YSL, PERVASIVE, PQIF, SMTEL, CWD, FABTECH, IIRM, BMWVENTLTD, EBIX.
Placed by industry label with low confidence: SETL, INTEGRAEN (precision_engineering), MRTX (ems_system_integration), MRUTR, YOGI (nbfc_diversified), BIZOTIC, CPML (apparel_brands_fashion_retail), INOVSYNTH, VIKRAMTH (chem_amines_intermediates), AEROENTER, BMW (steel_pipes_tubes).

## Diff versus the first draft
- First draft: 28 majors, 180 baskets. Now: 33 majors, 196 baskets.
- Baskets added: dc_connectivity_subsea, dc_it_hardware_distribution, dc_construction_mep, semicon_ultrapure_water, power_semiconductors_discretes, semicon_fab_equipment_cleanroom, semicon_fluoropolymers, stationery_writing, aero_raw_materials_metallurgy, aero_aerostructures_airframe_assembly, aero_avionics_radar_mission_electronics, aero_drones_uav, recycling_ewaste_recovery, recycling_aluminium_scrap, recycling_lead_battery, recycling_plastics_rubber.
- Baskets dropped from the first draft: none.
- The 26 old keys the first draft retired were restored and filled; 10 of them were later merged for lacking 3 genuine names (see retired keys above).
- Pure plays replaced conglomerates in dc_colocation_hyperscale_operators, green_hydrogen and ev_charging_infra.
- stationery_writing was added, IGIL is labelled gem certification in jewellery_manufacturers_exporters, and ETHOSLTD stays in watches.

## Caveats
- Lower-confidence placements (business inferred from name or limited knowledge): ELITECON, GRPLTD, COSMICCRF, URJA, MMP, AMAL, AFCOM, GLOTTIS, TINNARUBR, GKWLIMITED, OSWALAGRO, HAZOOR, OMINFRAL, CCCL, ARTSON.
- Data centre baskets are mostly secondary memberships of names whose primary basket is elsewhere, so they have few primaries by design.
- Old-only symbols kept without a universe row: AIMTRON, SAHASRA, HVAX, SUPREMEPWR, INDLMETER, ALPEXSOLAR, ZODIAC, EMBASSY, MINDSPACE, BIRET, NXST, NAMOEWASTE, BAHETI, ARDEE, SUNLITE.
- Old-basket names confirmed placed: GUJENERGY is the universe id for Gujarat Gas (GUJGASLTD is not in the universe) and sits in city_gas_distribution; IEX (capital_market_infra), PIIND and KSCL (agrochemicals), CRAFTSMAN (precision_engineering), DCXINDIA (aero_systems_integration_ems), DIACABS (wires_cables).
- Intentionally excluded: AGARWALTUF, AGARWALFT, GLASSWALL and RTSPOWR are not in the universe CSV (market cap below the Rs 500 Cr cut or not listed under those ids), and the symbol rule only allows universe ids or existing basket symbols.
- Lab-grown diamonds: too few separately listed names above Rs 500 Cr, so they sit in jewellery_manufacturers_exporters.
- Drones have their own basket (aero_drones_uav) and most members also sit in defence_electronics; ammunition and explosives have their own basket.
