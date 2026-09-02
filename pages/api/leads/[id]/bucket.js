const connectDB = require("../../../../lib/db");
const Lead = require("../../../../models/Lead");
const { requireCompanyMember } = require("../../../../lib/auth");
const { leadOwnershipFilter } = require("../../../../lib/leadAccess");
const { prettyBucket } = require("../../../../lib/leadFields");

// "unassigned" is the default every lead starts in and "lost" is the only
// other non-permanent bucket — a user can only ever explicitly request one
// of these three; "unassigned" is a starting point, never a destination.
const REQUESTABLE_BUCKETS = ["qualified", "retail", "lost"];
const EDITABLE_BUCKETS = ["unassigned", "lost"];

// Qualified/Retail are permanent — once a lead lands there, no further
// bucket move is allowed, in either direction. Unassigned and Lost are both
// editable: a lead can move freely between them, or out to Qualified/Retail,
// which immediately and permanently locks it there.
async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  const { bucket: requestedBucket } = req.body || {};
  if (!REQUESTABLE_BUCKETS.includes(requestedBucket)) {
    return res.status(400).json({ error: `bucket must be one of: ${REQUESTABLE_BUCKETS.join(", ")}` });
  }

  await connectDB();
  const filter = leadOwnershipFilter(req.session, id);

  const current = await Lead.findOne(filter).select("bucket").lean();
  if (!current) return res.status(404).json({ error: "Lead not found" });

  const currentBucket = current.bucket || "unassigned";
  if (!EDITABLE_BUCKETS.includes(currentBucket)) {
    return res.status(403).json({ error: `${prettyBucket(currentBucket)} bucket is permanently locked` });
  }

  if (requestedBucket === "lost" && currentBucket === "lost") {
    // Lost -> Lost is a valid no-op per the transition matrix — nothing
    // actually changes, so there's nothing to write or record.
    const lead = await Lead.findOne(filter);
    return res.status(200).json({ lead });
  }

  const actorName = req.session.name || req.session.username || "Unknown";
  const now = new Date();
  // Guarding the update filter on "still editable" makes this atomic
  // against a race with a concurrent bucket change landing between the read
  // above and this write. Leads created before this field existed have no
  // `bucket` at all yet (schema default only applies to new documents) —
  // $exists:false counts as "unassigned" here for the same reason the read
  // above treats it that way.
  const editableGuard = { $or: [{ bucket: "unassigned" }, { bucket: "lost" }, { bucket: { $exists: false } }] };

  if (requestedBucket === "lost") {
    // unassigned -> lost: a real move, but stays editable/unlocked — the
    // lead can still be recovered to Qualified/Retail later.
    const lead = await Lead.findOneAndUpdate(
      { ...filter, ...editableGuard },
      {
        $set: { bucket: "lost" },
        $push: { bucketHistory: { from: currentBucket, to: "lost", at: now, by: actorName, locked: false } },
      },
      { new: true }
    );
    if (!lead) return res.status(409).json({ error: "This lead's bucket was already locked by another update" });
    return res.status(200).json({ lead });
  }

  // qualified or retail — permanent lock, reachable from either Unassigned
  // or Lost.
  const lead = await Lead.findOneAndUpdate(
    { ...filter, ...editableGuard },
    {
      $set: { bucket: requestedBucket, bucketLocked: true, bucketLockedAt: now, bucketLockedBy: actorName },
      $push: { bucketHistory: { from: currentBucket, to: requestedBucket, at: now, by: actorName, locked: true } },
    },
    { new: true }
  );

  if (!lead) {
    return res.status(409).json({ error: "This lead's bucket was already locked by another update" });
  }

  res.status(200).json({ lead });
}

export default requireCompanyMember(handler);
