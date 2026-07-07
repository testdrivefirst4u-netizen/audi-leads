// Sheet column names vary slightly per model tab (e.g. "any_plan_to_exchange"
// vs "any_plan_to_exchange_your_existing_vehicle?"), so table columns are
// resolved by regex against whatever headers each row actually has.
export function pickField(data, patterns) {
  if (!data) return "";
  const keys = Object.keys(data);
  for (const pattern of patterns) {
    const key = keys.find((k) => pattern.test(k));
    if (key && data[key]) return data[key];
  }
  return "";
}

export const FIELD_MATCHERS = {
  createdTime: [/created_time/i],
  campaign: [/campaign_name/i],
  purchaseTimeline: [/when_are_you_planning_to_purchase/i],
  exchangePlan: [/any_plan_to_exchange/i],
  showroom: [/showroom|preferred.*location/i],
};
