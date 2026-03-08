const NOTION_VERSION = "2022-06-28";

const SOURCE_DATA_SOURCE_ID = process.env.NOTION_SOURCE_DATA_SOURCE_ID;
const TRACKING_DATA_SOURCE_ID = process.env.NOTION_TRACKING_DATA_SOURCE_ID;
const NOTION_TOKEN = process.env.NOTION_TOKEN;

/*
  CHANGE THESE TO MATCH YOUR NOTION PROPERTY NAMES
*/
const SOURCE_TITLE_PROP = "Name";       // title property in source db
const SOURCE_ARCHIVE_PROP = null;       // optional, e.g. "Visible" or "Active"
const TRACKING_TITLE_PROP = "Name";     // not used in this file, okay to keep
const TRACKING_RELATION_PROP = "Habits"; // relation property in tracking db -> source db

function notionHeaders() {
  return {
    "Authorization": `Bearer ${NOTION_TOKEN}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION
  };
}

function getPlainTitle(page, propName) {
  const prop = page.properties?.[propName];
  if (!prop || prop.type !== "title") return "Untitled";
  return (prop.title || []).map(t => t.plain_text).join("").trim() || "Untitled";
}

function getRelationIds(page, propName) {
  const prop = page.properties?.[propName];
  if (!prop || prop.type !== "relation") return [];
  return (prop.relation || []).map(r => r.id);
}

function getTodayBounds() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

async function queryDatabase(databaseId, body) {
  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: "POST",
    headers: notionHeaders(),
    body: JSON.stringify(body || {})
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || "Notion query failed");
  }

  return data;
}

export default async function handler(req, res) {
  try {
    if (!NOTION_TOKEN || !SOURCE_DATA_SOURCE_ID || !TRACKING_DATA_SOURCE_ID) {
      return res.status(500).json({
        error: "Missing NOTION_TOKEN, NOTION_SOURCE_DATA_SOURCE_ID, or NOTION_TRACKING_DATA_SOURCE_ID."
      });
    }

    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { start, end } = getTodayBounds();

    const sourceQuery = {
      page_size: 100,
      sorts: [
        {
          timestamp: "last_edited_time",
          direction: "descending"
        }
      ]
    };

    if (SOURCE_ARCHIVE_PROP) {
      sourceQuery.filter = {
        property: SOURCE_ARCHIVE_PROP,
        checkbox: { equals: true }
      };
    }

    const trackingQuery = {
      page_size: 100,
      filter: {
        and: [
          {
            timestamp: "created_time",
            created_time: {
              on_or_after: start
            }
          },
          {
            timestamp: "created_time",
            created_time: {
              on_or_before: end
            }
          }
        ]
      }
    };

    const [sourceData, trackingData] = await Promise.all([
      queryDatabase(SOURCE_DATA_SOURCE_ID, sourceQuery),
      queryDatabase(TRACKING_DATA_SOURCE_ID, trackingQuery)
    ]);

    const doneSet = new Set();

    for (const logPage of trackingData.results || []) {
      const relatedHabitIds = getRelationIds(logPage, TRACKING_RELATION_PROP);
      for (const id of relatedHabitIds) {
        doneSet.add(id);
      }
    }

    const habits = (sourceData.results || []).map(page => ({
      id: page.id,
      name: getPlainTitle(page, SOURCE_TITLE_PROP),
      done: doneSet.has(page.id)
    }));

    return res.status(200).json({ habits });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to load habits"
    });
  }
}
