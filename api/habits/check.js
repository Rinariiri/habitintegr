const NOTION_VERSION = "2022-06-28";

const SOURCE_DATA_SOURCE_ID = process.env.NOTION_SOURCE_DATA_SOURCE_ID;
const TRACKING_DATA_SOURCE_ID = process.env.NOTION_TRACKING_DATA_SOURCE_ID;
const NOTION_TOKEN = process.env.NOTION_TOKEN;

/*
  CHANGE THESE TO MATCH YOUR NOTION PROPERTY NAMES
*/
const SOURCE_TITLE_PROP = "Name";         // source db title
const TRACKING_TITLE_PROP = "Name";       // tracking db title
const TRACKING_RELATION_PROP = "Habits";  // tracking db relation -> source db

function notionHeaders() {
  return {
    "Authorization": `Bearer ${NOTION_TOKEN}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION
  };
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

async function retrievePage(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "GET",
    headers: notionHeaders()
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || "Failed to retrieve source page");
  }

  return data;
}

function getPlainTitle(page, propName) {
  const prop = page.properties?.[propName];
  if (!prop || prop.type !== "title") return "Untitled";
  return (prop.title || []).map(t => t.plain_text).join("").trim() || "Untitled";
}

export default async function handler(req, res) {
  try {
    if (!NOTION_TOKEN || !SOURCE_DATA_SOURCE_ID || !TRACKING_DATA_SOURCE_ID) {
      return res.status(500).json({
        error: "Missing NOTION_TOKEN, NOTION_SOURCE_DATA_SOURCE_ID, or NOTION_TRACKING_DATA_SOURCE_ID."
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { habitId } = req.body || {};

    if (!habitId) {
      return res.status(400).json({ error: "Missing habitId" });
    }

    const { start, end } = getTodayBounds();

    const existing = await queryDatabase(TRACKING_DATA_SOURCE_ID, {
      page_size: 10,
      filter: {
        and: [
          {
            property: TRACKING_RELATION_PROP,
            relation: {
              contains: habitId
            }
          },
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
    });

    if ((existing.results || []).length > 0) {
      return res.status(200).json({
        ok: true,
        alreadyExisted: true
      });
    }

    const sourcePage = await retrievePage(habitId);
    const habitName = getPlainTitle(sourcePage, SOURCE_TITLE_PROP);
    const todayLabel = new Date().toISOString().slice(0, 10);

    const createRes = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: notionHeaders(),
      body: JSON.stringify({
        parent: {
          database_id: TRACKING_DATA_SOURCE_ID
        },
        properties: {
          [TRACKING_TITLE_PROP]: {
            title: [
              {
                text: {
                  content: `${habitName}`
                }
              }
            ]
          },
          [TRACKING_RELATION_PROP]: {
            relation: [
              { id: habitId }
            ]
          }
        }
      })
    });

    const createData = await createRes.json();

    if (!createRes.ok) {
      return res.status(createRes.status).json({
        error: createData.message || "Failed to create tracking page"
      });
    }

    return res.status(200).json({
      ok: true,
      created: true,
      pageId: createData.id
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to create tracking page"
    });
  }
}
