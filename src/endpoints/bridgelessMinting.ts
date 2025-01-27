import { Access, z } from "../lib/access/index.js";
import { Source } from "../lib/source/Source.js";
import { Interface, Log } from "ethers";

const MOCK_ADDRESSES = {
  "6283": "0xfffffffffffffffffffffffe0000000000000119", // LAOS Mainnet address for GoalRev collection
  "137": "0x9f16fc5a49afa724407225e97edb8775fe4eb9fb", // Polygon GoalRev production address
};

// ABI definitions
const polygonABI = [
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",  // Added 'indexed' to match the event signature
];

const laosABI = [
  "event MintedWithExternalURI(address indexed _to, uint96 _slot, uint256 _tokenId, string _tokenURI)",
];

const polygonInterface = new Interface(polygonABI);
const laosInterface = new Interface(laosABI);

export const registerBridgelessMintingEndpoint = (access: Access) => {
  access.registerEndpoint({
    path: "/bridgeless-minting",
    method: "get",
    request: {
      query: z.object({
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
        limitPerChain: z.number().optional().default(100),
      }),
    },
    handler: async ({ query }) => {
      const source = new Source();
      const defaultStartDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const defaultEndDate = new Date().toISOString();

      // Create separate promises for each chain
      const laosMintEvents = source.events.get("6283", {
        filters: {
          address: MOCK_ADDRESSES["6283"],
          topic_0: "0xa7135052b348b0b4e9943bae82d8ef1c5ac225e594ef4271d12f0744cfc98348", // Minting topic
          block_timestamp: [
            {
              operator: "gte",
              value: Math.floor(new Date(query.startDate || defaultStartDate).getTime() / 1000),
            },
            {
              operator: "lte",
              value: Math.floor(new Date(query.endDate || defaultEndDate).getTime() / 1000),
            },
          ],
        },
        orderBy: {
          field: ["block_timestamp"],
          direction: "desc",
        },
        pagination: {
          limit: query.limitPerChain,
        },
      });

      const polygonTransferEvents = source.events.get("137", {
        filters: {
          address: MOCK_ADDRESSES["137"],
          topic_0: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", // Transfer topic
          block_timestamp: [
            {
              operator: "gte",
              value: Math.floor(new Date(query.startDate || defaultStartDate).getTime() / 1000),
            },
            {
              operator: "lte",
              value: Math.floor(new Date(query.endDate || defaultEndDate).getTime() / 1000),
            },
          ],
        },
        orderBy: {
          field: ["block_timestamp"],
          direction: "desc",
        },
        pagination: {
          limit: query.limitPerChain,
        },
      });

      // Await both results
      const [laosResults, polygonResults] = await Promise.all([laosMintEvents, polygonTransferEvents]);

      // Decode LAOS events
      const decodedLaosEvents = (laosResults.data as Log[]).map((log) => {
        try {
          const decoded = laosInterface.parseLog({
            topics: log.topics,
            data: log.data,
          });

          return {
            ...log,
            content: {
              event: decoded.name,
              args: {
                to: decoded.args._to,
                slot: decoded.args._slot.toString(),
                tokenId: decoded.args._tokenId.toString(),
                tokenURI: decoded.args._tokenURI,
              },
            },
          };
        } catch (error) {
          console.error("Failed to decode LAOS log:", error);
          return log;
        }
      });

      // Decode Polygon events
      const decodedPolygonEvents = (polygonResults.data as Log[]).map((log) => {
        try {
          // For Transfer events, all parameters are indexed, so we can extract them directly from topics
          // topics[0] is the event signature
          // topics[1] is the from address
          // topics[2] is the to address
          // topics[3] is the tokenId
          const from = `0x${log.topics[1].slice(-40)}`;  // Remove '0x' and take last 40 chars
          const to = `0x${log.topics[2].slice(-40)}`;
          const tokenId = BigInt(log.topics[3]).toString();

          return {
            ...log,
            content: {
              event: "Transfer",
              args: {
                from,
                to,
                tokenId,
              },
            },
          };
        } catch (error) {
          console.error("Failed to decode Polygon log:", error);
          return log;
        }
      });

      // Return both raw data and decoded content
      return {
        data: {
          laos: decodedLaosEvents,
          polygon: decodedPolygonEvents,
        },
      };
    },
  });
};