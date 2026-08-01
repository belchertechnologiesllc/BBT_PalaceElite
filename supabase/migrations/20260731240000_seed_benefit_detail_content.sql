-- Structured benefit-detail domain: seed content for the seven launch
-- benefits, product-owner-approved from review of the signed VIP Silver
-- Affiliation Contract (a source document that does not exist inside this
-- repository -- see docs/claude-reports/BENEFIT-DETAILS-STEP-2.md).
--
-- Every row below is matched by benefit_code only (backfilled in
-- 20260731230000), never by the mutable name column. This migration does
-- not alter benefit_grants.name, pool, quantity_kind, original_quantity,
-- release_date, expiration_date, or restrictions -- structured content
-- supplements those fields, it never replaces or corrects accounting data.
-- In particular:
--   * Incentive Stays' accounting original_quantity remains 6, even though
--     the reviewed contract table appears to show 4 -- that discrepancy is
--     recorded as a visible, unresolved confirmation item below, not
--     silently corrected here.
--   * Golf Rounds at 50%'s expiration_date remains NULL -- no date is
--     invented; contract_expiration_text below explicitly avoids ever
--     claiming the benefit "never expires."
--   * Spa Resort Credit's name remains "Spa Resort Credit" -- the
--     contract's "Spa Resort Credit Pack" phrasing is recorded as
--     structured content only, never as a rename.
--   * Unlimited Golf Bonus Nights' original_quantity remains 8 -- this is
--     not treated as contradicting the benefit's name; see its
--     plain_language_summary below.

-- =============================================================================
-- 1. benefit_grant_details (one row per benefit, matched by benefit_code)
-- =============================================================================

insert into public.benefit_grant_details (
  benefit_grant_id, plain_language_summary, cost_model, stay_plan,
  minimum_nights, maximum_nights, guests_included, discount_percentages,
  service_fee_required, gold_season_only,
  contract_quantity_text, contract_expiration_text, contract_source_reference
)
select g.id, v.plain_language_summary, v.cost_model::public.benefit_cost_model,
  v.stay_plan::public.benefit_stay_plan, v.minimum_nights, v.maximum_nights,
  v.guests_included, v.discount_percentages, v.service_fee_required,
  v.gold_season_only, v.contract_quantity_text, v.contract_expiration_text,
  v.contract_source_reference
from public.benefit_grants g
join (
  values
  (
    'bpg_weeks',
    'A paid hotel stay using the VIP Silver preferential-rate schedule. It is a discounted booking benefit, not a complimentary week.',
    'discounted', 'property_dependent',
    null::integer, null::integer, null::integer,
    array[20, 30, 60]::numeric[], null::boolean, false,
    '100 BPG Weeks, including 10 weeks that may be exercised as up to 70 BPG Nights.',
    'March 29, 2051',
    'VIP Silver Affiliation Contract — Benefits Table and Definitions'
  ),
  (
    'incentive_stays',
    'A paid four-to-seven-night promotional stay that receives an additional incentive discount on top of the applicable BPG treatment, subject to qualifying property, suite, occupancy, and season rules.',
    'discounted', 'property_dependent',
    4, 7, null::integer,
    array[20, 30]::numeric[], null::boolean, true,
    'Contract table appears to list 4 Incentive Stays; the application allocation currently records 6.',
    'March 29, 2033',
    'VIP Silver Affiliation Contract — Benefits Table and Definitions'
  ),
  (
    'imperial_grand_weeks',
    'A complimentary seven-night, eight-day All-Inclusive Standard Suite stay for two people at qualifying Palace properties during Gold Season.',
    'complimentary', 'all_inclusive',
    7, 7, 2,
    null::numeric[], false, true,
    '2 Imperial Grand Weeks',
    'March 29, 2031',
    'VIP Silver Affiliation Contract — Benefits Table and Definitions'
  ),
  (
    'spa_resort_credit',
    'A restricted resort-service credit described by the contract as a Spa Resort Credit Pack. It is not cash and requires payment of an applicable service fee when used.',
    'credit', 'not_applicable',
    null::integer, null::integer, null::integer,
    null::numeric[], true, false,
    '$3,740 Spa Resort Credit Pack',
    'March 29, 2031',
    'VIP Silver Affiliation Contract — Benefits Table and Definitions'
  ),
  (
    'universal_credit',
    'A flexible non-cash membership credit that may be applied toward several qualifying travel, resort, entertainment, and accommodation expenses.',
    'credit', 'not_applicable',
    null::integer, null::integer, null::integer,
    null::numeric[], null::boolean, false,
    '$280 Universal Credit',
    'March 29, 2029',
    'VIP Silver Affiliation Contract — Benefits Table and Definitions'
  ),
  (
    'golf_rounds_50',
    'Twenty opportunities to purchase an eligible golf round at 50% of the then-current public U.S.-dollar rate at the specified Moon Palace golf courses.',
    'discounted', 'not_applicable',
    null::integer, null::integer, null::integer,
    array[50]::numeric[], null::boolean, false,
    '20 golf rounds at a 50% discount',
    'No separate expiration is listed; use remains subject to the affiliation''s validity and current program rules.',
    'VIP Silver Affiliation Contract — Benefits Table and Definitions'
  ),
  (
    'unlimited_golf_bonus_nights',
    'Eight qualifying bonus nights, each providing complimentary unlimited golf for two people sharing the same room at the specified Moon Palace golf courses, subject to availability and operational rules.',
    'complimentary', 'property_dependent',
    null::integer, null::integer, 2,
    null::numeric[], null::boolean, false,
    '8 qualifying Unlimited Golf Bonus Nights',
    'March 29, 2031',
    'VIP Silver Affiliation Contract — Benefits Table and Definitions'
  )
) as v(
  benefit_code, plain_language_summary, cost_model, stay_plan,
  minimum_nights, maximum_nights, guests_included, discount_percentages,
  service_fee_required, gold_season_only,
  contract_quantity_text, contract_expiration_text, contract_source_reference
)
  on v.benefit_code = g.benefit_code;

-- =============================================================================
-- 2. benefit_detail_items -- BPG Weeks
-- =============================================================================

insert into public.benefit_detail_items (benefit_grant_id, section, statement, source_type, display_order)
select g.id, v.section::public.benefit_detail_section, v.statement,
  v.source_type::public.benefit_detail_source_type, v.display_order
from public.benefit_grants g
join (
  values
  ('included', 'Provides access to a preferential member rate rather than a complimentary stay.', 'contract', 10),
  ('included', 'The applicable discount may be 20%, 30%, or 60%, depending on the property, room or suite category, and occupancy requirements.', 'contract', 20),
  ('included', 'Ten of the BPG Weeks may be exercised as up to 70 BPG Nights.', 'contract', 30),
  ('excluded', 'Additional-adult and minor charges are not included in the BPG discount.', 'contract', 10),
  ('excluded', 'Hotel-and-airfare packages are not eligible for the BPG discount.', 'contract', 20),
  ('eligible_properties', 'Applies only at qualifying Palace, Le Blanc, and Baglioni establishments identified by the affiliation program and current BPG matrix.', 'contract', 10),
  ('fees_and_costs', 'The traveler pays the resulting discounted accommodation rate.', 'contract', 10),
  ('fees_and_costs', 'All-Inclusive or European Plan treatment depends on the selected property.', 'contract', 20),
  ('confirmation_questions', 'Confirm the current BPG matrix, eligible room category, occupancy rule, and discount percentage before booking.', 'confirm_before_use', 10),
  ('confirmation_questions', 'Confirm how partially used converted BPG Nights affect the underlying convertible-week balance.', 'confirm_before_use', 20)
) as v(section, statement, source_type, display_order)
  on true
where g.benefit_code = 'bpg_weeks';

-- =============================================================================
-- 3. benefit_detail_items -- Incentive Stays
-- =============================================================================

insert into public.benefit_detail_items (benefit_grant_id, section, statement, source_type, display_order)
select g.id, v.section::public.benefit_detail_section, v.statement,
  v.source_type::public.benefit_detail_source_type, v.display_order
from public.benefit_grants g
join (
  values
  ('included', 'Applies to a continuous stay of at least four and no more than seven nights.', 'contract', 10),
  ('included', 'Qualifying standard-suite stays receive the applicable BPG treatment plus an additional 20% Incentive Stay discount.', 'contract', 20),
  ('included', 'Qualifying special-category suites are subject to their applicable BPG and occupancy rules plus the additional Incentive Stay discount.', 'contract', 30),
  ('included', 'A qualifying continuous Baglioni itinerary may include more than one participating Baglioni establishment while remaining within the four-to-seven-night total.', 'contract', 40),
  ('season_rules', 'Available during Gold Season.', 'contract', 10),
  ('season_rules', 'Gold Season excludes the nights from December 24 through January 1.', 'contract', 20),
  ('occupancy_rules', 'Suite-category and minimum-occupancy requirements apply.', 'contract', 10),
  ('fees_and_costs', 'This is a discounted paid stay, not a complimentary stay.', 'contract', 10),
  ('confirmation_questions', 'The contract table appears to list four Incentive Stays while the application currently records six; the source of the additional two must be reconciled before changing the accounting allocation.', 'confirm_before_use', 10),
  ('confirmation_questions', 'Confirm whether the BPG and additional Incentive Stay percentages are applied sequentially or under another program calculation.', 'confirm_before_use', 20),
  ('confirmation_questions', 'Confirm current release-date and booking-window procedures.', 'confirm_before_use', 30)
) as v(section, statement, source_type, display_order)
  on true
where g.benefit_code = 'incentive_stays';

-- =============================================================================
-- 4. benefit_detail_items -- Imperial Grand Weeks
-- =============================================================================

insert into public.benefit_detail_items (benefit_grant_id, section, statement, source_type, display_order)
select g.id, v.section::public.benefit_detail_section, v.statement,
  v.source_type::public.benefit_detail_source_type, v.display_order
from public.benefit_grants g
join (
  values
  ('included', 'Includes seven nights and eight days in a qualifying Standard Suite.', 'contract', 10),
  ('included', 'Includes the All-Inclusive Plan for two people.', 'contract', 20),
  ('eligible_properties', 'Applies only to qualifying Palace properties identified for Imperial Grand Weeks in the affiliation benefit matrix.', 'contract', 10),
  ('eligible_properties', 'It is not shown as applicable to Le Blanc or Baglioni properties in the reviewed benefit matrix.', 'contract', 20),
  ('season_rules', 'Available during Gold Season.', 'contract', 10),
  ('season_rules', 'Gold Season excludes the nights from December 24 through January 1.', 'contract', 20),
  ('occupancy_rules', 'Base occupancy is two people sharing the qualifying suite.', 'contract', 10),
  ('fees_and_costs', 'Additional-person charges may apply.', 'contract', 10),
  ('fees_and_costs', 'Airfare, upgrades, golf, spa services, excursions, and other separately purchased services are not part of the stated complimentary accommodation entitlement.', 'contract', 20),
  ('confirmation_questions', 'Confirm the current participating property list, room category availability, and charges for additional guests before booking.', 'confirm_before_use', 10)
) as v(section, statement, source_type, display_order)
  on true
where g.benefit_code = 'imperial_grand_weeks';

-- =============================================================================
-- 5. benefit_detail_items -- Spa Resort Credit
-- =============================================================================

insert into public.benefit_detail_items (benefit_grant_id, section, statement, source_type, display_order)
select g.id, v.section::public.benefit_detail_section, v.statement,
  v.source_type::public.benefit_detail_source_type, v.display_order
from public.benefit_grants g
join (
  values
  ('included', 'Provides a restricted credit toward qualifying resort products or services.', 'contract', 10),
  ('included', 'The signed contract refers to this entitlement as a Spa Resort Credit Pack.', 'contract', 20),
  ('excluded', 'The credit is not a cash refund.', 'contract', 10),
  ('excluded', 'The credit is not transferable to third parties.', 'contract', 20),
  ('eligible_properties', 'Applies only at qualifying Palace and Le Blanc establishments identified by the affiliation benefit matrix.', 'contract', 10),
  ('fees_and_costs', 'An applicable service fee must be paid when the qualifying product or service is reserved or purchased.', 'contract', 10),
  ('fees_and_costs', 'The service fee may vary by establishment.', 'contract', 20),
  ('confirmation_questions', 'Confirm the current eligible-service list, service-fee percentage, redemption limits, and whether unused credit remains after partial use.', 'confirm_before_use', 10)
) as v(section, statement, source_type, display_order)
  on true
where g.benefit_code = 'spa_resort_credit';

-- =============================================================================
-- 6. benefit_detail_items -- Universal Credit
-- =============================================================================

insert into public.benefit_detail_items (benefit_grant_id, section, statement, source_type, display_order)
select g.id, v.section::public.benefit_detail_section, v.statement,
  v.source_type::public.benefit_detail_source_type, v.display_order
from public.benefit_grants g
join (
  values
  ('included', 'May be applied toward qualifying spa treatments.', 'contract', 10),
  ('included', 'May be applied toward qualifying golf rounds.', 'contract', 20),
  ('included', 'May be applied toward qualifying tours or excursions.', 'contract', 30),
  ('included', 'May be applied toward qualifying concert or show tickets.', 'contract', 40),
  ('included', 'May be applied toward qualifying day passes.', 'contract', 50),
  ('included', 'May be applied toward qualifying yacht hours.', 'contract', 60),
  ('included', 'May be applied toward qualifying room charges or hotel bookings.', 'contract', 70),
  ('included', 'May be applied toward qualifying additional-person charges.', 'contract', 80),
  ('included', 'May be applied toward qualifying room-upgrade fees.', 'contract', 90),
  ('eligible_properties', 'Shown as available across qualifying Palace, Le Blanc, and Baglioni establishments in the reviewed benefit matrix.', 'contract', 10),
  ('excluded', 'Treat the entitlement as a restricted program credit, not ordinary cash.', 'contract', 10),
  ('confirmation_questions', 'Confirm whether a service fee applies to the selected redemption.', 'confirm_before_use', 10),
  ('confirmation_questions', 'Confirm whether partial use is permitted and whether unused value remains available afterward.', 'confirm_before_use', 20),
  ('confirmation_questions', 'Confirm whether the credit may be combined with other promotions or credits.', 'confirm_before_use', 30),
  ('confirmation_questions', 'Confirm property-specific availability and the redemption procedure.', 'confirm_before_use', 40)
) as v(section, statement, source_type, display_order)
  on true
where g.benefit_code = 'universal_credit';

-- =============================================================================
-- 7. benefit_detail_items -- Golf Rounds at 50%
-- =============================================================================

insert into public.benefit_detail_items (benefit_grant_id, section, statement, source_type, display_order)
select g.id, v.section::public.benefit_detail_section, v.statement,
  v.source_type::public.benefit_detail_source_type, v.display_order
from public.benefit_grants g
join (
  values
  ('included', 'Each qualifying use provides a 50% discount from the then-current public U.S.-dollar golf rate.', 'contract', 10),
  ('included', 'The public golf rate may change over time.', 'contract', 20),
  ('eligible_properties', 'Applies at Moon Palace Cancun Golf Course and Moon Palace The Grand Punta Cana Golf Course.', 'contract', 10),
  ('eligible_properties', 'The entitlement belongs to the Golf pool and is limited by the application''s approved Golf-pool participation rules.', 'contract', 20),
  ('fees_and_costs', 'The golfer pays the remaining discounted charge.', 'contract', 10),
  ('confirmation_questions', 'Confirm whether cart, club rental, caddie, range balls, taxes, food, beverages, premium tee times, and tournament surcharges are included or charged separately.', 'confirm_before_use', 10),
  ('confirmation_questions', 'Confirm the current public reference rate before booking.', 'confirm_before_use', 20)
) as v(section, statement, source_type, display_order)
  on true
where g.benefit_code = 'golf_rounds_50';

-- =============================================================================
-- 8. benefit_detail_items -- Unlimited Golf Bonus Nights
-- =============================================================================

insert into public.benefit_detail_items (benefit_grant_id, section, statement, source_type, display_order)
select g.id, v.section::public.benefit_detail_section, v.statement,
  v.source_type::public.benefit_detail_source_type, v.display_order
from public.benefit_grants g
join (
  values
  ('included', 'The allocation consists of eight qualifying bonus nights.', 'contract', 10),
  ('included', 'During each qualifying bonus night, two people sharing the same room receive the stated unlimited-golf entitlement.', 'contract', 20),
  ('eligible_properties', 'Applies at Moon Palace Cancun Golf Course and Moon Palace The Grand Punta Cana Golf Course.', 'contract', 10),
  ('eligible_properties', 'The entitlement belongs to the Golf pool and is limited by the application''s approved Golf-pool participation rules.', 'contract', 20),
  ('occupancy_rules', 'The stated entitlement covers two people sharing the same room.', 'contract', 10),
  ('fees_and_costs', 'The golf entitlement is stated as complimentary for the two qualifying occupants during an eligible bonus night.', 'contract', 10),
  ('confirmation_questions', 'Confirm tee-time availability and replay-round rules.', 'confirm_before_use', 10),
  ('confirmation_questions', 'Confirm whether arrival and departure days are included.', 'confirm_before_use', 20),
  ('confirmation_questions', 'Confirm whether carts, caddies, club rentals, range balls, taxes, or premium tee-time charges are included.', 'confirm_before_use', 30),
  ('confirmation_questions', 'Confirm whether the qualifying hotel stay must use a particular benefit or rate type.', 'confirm_before_use', 40)
) as v(section, statement, source_type, display_order)
  on true
where g.benefit_code = 'unlimited_golf_bonus_nights';
