// Real cXML punch-out documents (PunchOutSetupRequest/Response, PunchOutOrderMessage) — the
// standard Ariba/cXML protocol Amazon Business, SAP Ariba, Coupa etc. all speak. Building via
// fast-xml-parser's XMLBuilder (not template literals) so interpolated text (product names,
// user emails) is auto-escaped rather than risking invalid XML on a stray "&"/"<"/">".
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import type { PunchoutCartLine } from "@shared/schema";

const ATTR_PREFIX = "@_";

const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: ATTR_PREFIX, format: true });
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: ATTR_PREFIX });
// ItemIn must always come back as an array, even with a single cart line.
const orderMessageParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  isArray: (name, jpath) => jpath === "cXML.Message.PunchOutOrderMessage.ItemIn",
});

function toXml(obj: unknown): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(obj)}`;
}

function payloadId(seed: string): string {
  return `${Date.now()}.${seed}@ounda-procure`;
}

function textOf(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "object") return String((node as Record<string, unknown>)["#text"] ?? "");
  return String(node);
}

// ---------- PunchOutSetupRequest (buyer -> supplier) ----------

export function buildSetupRequestCxml(opts: {
  buyerCookie: string;
  callbackUrl: string;
  userEmail: string;
  sharedSecret: string;
  ourIdentity: string;
}): string {
  return toXml({
    cXML: {
      [`${ATTR_PREFIX}payloadID`]: payloadId(opts.buyerCookie),
      [`${ATTR_PREFIX}timestamp`]: new Date().toISOString(),
      Header: {
        From: { Credential: { [`${ATTR_PREFIX}domain`]: "NetworkID", Identity: opts.ourIdentity } },
        To: { Credential: { [`${ATTR_PREFIX}domain`]: "NetworkID", Identity: "AMAZON-BUSINESS" } },
        Sender: {
          Credential: {
            [`${ATTR_PREFIX}domain`]: "NetworkID",
            Identity: opts.ourIdentity,
            SharedSecret: opts.sharedSecret,
          },
          UserAgent: "OUNDA Procure Punch-Out Client",
        },
      },
      Request: {
        PunchOutSetupRequest: {
          [`${ATTR_PREFIX}operation`]: "create",
          BuyerCookie: opts.buyerCookie,
          Extrinsic: { [`${ATTR_PREFIX}name`]: "UserEmail", "#text": opts.userEmail },
          BrowserFormPost: { URL: opts.callbackUrl },
        },
      },
    },
  });
}

export function parseSetupRequestCxml(
  xml: string,
  expectedSharedSecret: string
): { buyerCookie: string; browserFormPostUrl: string; sharedSecretOk: boolean } {
  const parsed = parser.parse(xml);
  const cxml = parsed?.cXML ?? {};
  const sender = cxml?.Header?.Sender?.Credential;
  const request = cxml?.Request?.PunchOutSetupRequest;
  return {
    buyerCookie: String(request?.BuyerCookie ?? ""),
    browserFormPostUrl: String(request?.BrowserFormPost?.URL ?? ""),
    sharedSecretOk: sender?.SharedSecret === expectedSharedSecret,
  };
}

// ---------- PunchOutSetupResponse (supplier -> buyer) ----------

export function buildSetupResponseCxml(opts: { startPageUrl: string }): string {
  return toXml({
    cXML: {
      [`${ATTR_PREFIX}payloadID`]: payloadId("setup-response"),
      [`${ATTR_PREFIX}timestamp`]: new Date().toISOString(),
      Response: {
        Status: { [`${ATTR_PREFIX}code`]: "200", [`${ATTR_PREFIX}text`]: "OK" },
        PunchOutSetupResponse: {
          StartPage: { URL: opts.startPageUrl },
        },
      },
    },
  });
}

export function parseSetupResponseCxml(xml: string): { startPageUrl: string } {
  const parsed = parser.parse(xml);
  const startPageUrl = parsed?.cXML?.Response?.PunchOutSetupResponse?.StartPage?.URL;
  if (!startPageUrl) throw new Error("cXML PunchOutSetupResponse enthält keine StartPage-URL.");
  return { startPageUrl: String(startPageUrl) };
}

// ---------- PunchOutOrderMessage (supplier -> buyer callback, the returned cart) ----------

export function buildOrderMessageCxml(opts: { buyerCookie: string; cart: PunchoutCartLine[] }): string {
  const total = opts.cart.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  return toXml({
    cXML: {
      [`${ATTR_PREFIX}payloadID`]: payloadId(opts.buyerCookie),
      [`${ATTR_PREFIX}timestamp`]: new Date().toISOString(),
      Message: {
        PunchOutOrderMessage: {
          BuyerCookie: opts.buyerCookie,
          PunchOutOrderMessageHeader: {
            [`${ATTR_PREFIX}operationAllowed`]: "edit",
            Total: { Money: { [`${ATTR_PREFIX}currency`]: "EUR", "#text": total.toFixed(2) } },
          },
          ItemIn: opts.cart.map((line) => ({
            [`${ATTR_PREFIX}quantity`]: line.quantity,
            ItemID: { SupplierPartID: line.sku },
            ItemDetail: {
              UnitPrice: { Money: { [`${ATTR_PREFIX}currency`]: "EUR", "#text": line.unitPrice.toFixed(2) } },
              Description: { [`${ATTR_PREFIX}xml:lang`]: "de", "#text": line.name },
              UnitOfMeasure: "EA",
            },
          })),
        },
      },
    },
  });
}

export function parseOrderMessageCxml(xml: string): { buyerCookie: string; lines: PunchoutCartLine[] } {
  const parsed = orderMessageParser.parse(xml);
  const msg = parsed?.cXML?.Message?.PunchOutOrderMessage;
  if (!msg) throw new Error("cXML enthält keine PunchOutOrderMessage.");
  const itemsIn: any[] = Array.isArray(msg.ItemIn) ? msg.ItemIn : [];
  const lines: PunchoutCartLine[] = itemsIn.map((item) => ({
    sku: String(item?.ItemID?.SupplierPartID ?? ""),
    name: textOf(item?.ItemDetail?.Description),
    description: textOf(item?.ItemDetail?.Description),
    quantity: Number(item?.[`${ATTR_PREFIX}quantity`] ?? 1),
    unitPrice: Number(textOf(item?.ItemDetail?.UnitPrice?.Money) || 0),
  }));
  return { buyerCookie: String(msg.BuyerCookie ?? ""), lines };
}
