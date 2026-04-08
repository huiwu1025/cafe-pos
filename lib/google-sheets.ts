import crypto from "node:crypto";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

function getGoogleConfig() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!spreadsheetId || !clientEmail || !privateKey) {
    throw new Error("GOOGLE_SHEETS_ENV_MISSING");
  }

  return {
    spreadsheetId,
    clientEmail,
    privateKey,
  };
}

function base64UrlEncode(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getGoogleAccessToken() {
  const { clientEmail, privateKey } = getGoogleConfig();
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const payload = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };

  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(payload)
  )}`;

  const signature = crypto.createSign("RSA-SHA256").update(unsignedToken).sign(privateKey);
  const assertion = `${unsignedToken}.${base64UrlEncode(signature)}`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GOOGLE_TOKEN_FAILED: ${errorText}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

async function sheetsRequest(path: string, init?: RequestInit) {
  const { spreadsheetId } = getGoogleConfig();
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(`${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GOOGLE_SHEETS_REQUEST_FAILED: ${errorText}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function ensureSheetExists(title: string) {
  const metadata = (await sheetsRequest("?fields=sheets.properties.title")) as {
    sheets?: { properties?: { title?: string } }[];
  };

  const exists = metadata.sheets?.some((sheet) => sheet.properties?.title === title);
  if (exists) return;

  await sheetsRequest(":batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          addSheet: {
            properties: {
              title,
            },
          },
        },
      ],
    }),
  });
}

export async function readSheetValues(title: string) {
  try {
    const response = (await sheetsRequest(
      `/values/${encodeURIComponent(`${title}!A:ZZ`)}`
    )) as { values?: string[][] };
    return response.values ?? [];
  } catch (error) {
    const maybeMessage = error instanceof Error ? error.message : "";
    if (maybeMessage.includes("Unable to parse range")) {
      return [];
    }
    throw error;
  }
}

export async function replaceSheetValues(title: string, values: (string | number)[][]) {
  await ensureSheetExists(title);
  await sheetsRequest(`/values/${encodeURIComponent(`${title}!A:ZZ`)}:clear`, {
    method: "POST",
    body: JSON.stringify({}),
  });

  await sheetsRequest(`/values/${encodeURIComponent(`${title}!A1`)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({
      majorDimension: "ROWS",
      values,
    }),
  });
}

export async function mergeRowsByKey(
  title: string,
  headers: string[],
  rows: (string | number)[][]
) {
  await ensureSheetExists(title);
  const existing = await readSheetValues(title);
  const existingRows = existing.slice(1);
  const merged = new Map<string, (string | number)[]>();

  for (const row of existingRows) {
    if (!row[0]) continue;
    merged.set(String(row[0]), row);
  }

  for (const row of rows) {
    if (!row[0]) continue;
    merged.set(String(row[0]), row);
  }

  const nextValues = [headers, ...Array.from(merged.values())];
  await replaceSheetValues(title, nextValues);
}
