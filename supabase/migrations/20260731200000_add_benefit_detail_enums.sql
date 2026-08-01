-- Structured benefit-detail domain: enumerated types.
--
-- Four closed vocabularies for the upcoming benefit_grant_details /
-- benefit_detail_items tables (added in the two migrations that follow).
-- Declared here first since both tables reference these types.
--
-- benefit_detail_section's declaration order is load-bearing: Postgres
-- enums sort by declaration ordinal, not alphabetically, so a plain
-- `order by section` on benefit_detail_items yields the intended reading
-- order (included/excluded facts first, confirmation questions and
-- operational notes last) with no extra sort key -- the same technique
-- already used for benefit_pool ('shared' before 'golf').

create type public.benefit_cost_model as enum (
  'complimentary',
  'discounted',
  'credit',
  'mixed'
);

create type public.benefit_stay_plan as enum (
  'all_inclusive',
  'european_plan',
  'property_dependent',
  'not_applicable'
);

create type public.benefit_detail_source_type as enum (
  'contract',
  'operational',
  'inference',
  'confirm_before_use'
);

create type public.benefit_detail_section as enum (
  'included',
  'excluded',
  'eligible_properties',
  'season_rules',
  'occupancy_rules',
  'fees_and_costs',
  'redemption_steps',
  'confirmation_questions',
  'operational_notes'
);
