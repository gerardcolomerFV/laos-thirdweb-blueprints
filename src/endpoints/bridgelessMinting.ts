import { Access, z } from "../lib/access/index.js";
import { Source } from "../lib/source/Source.js";
import { Interface, Log } from "ethers";

const MOCK_ADDRESSES = {
  "6283": "0xfffffffffffffffffffffffe0000000000000119", // LAOS Mainnet address for GoalRev collection
  "137": "0x9f16fc5a49afa724407225e97edb8775fe4eb9fb", // Polygon GoalRev production address
};

// ABI definitions
const polygonABI = [
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

const laosABI = [
  "event MintedWithExternalURI(address indexed _to, uint96 _slot, uint256 _tokenId, string _tokenURI)",
];

const polygonInterface = new Interface(polygonABI);
const laosInterface = new Interface(laosABI);

interface DecodedEvent {
  chainId: string;
  blockNumber: string;
  blockTimestamp: number;
  transactionHash: string;
  event: string;
  tokenId: string;
  [key: string]: any;
}

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

      console.log("Fetching events from Thirdweb...");
      console.log("Query Parameters:", {
        startDate: query.startDate || defaultStartDate,
        endDate: query.endDate || defaultEndDate,
        limitPerChain: query.limitPerChain,
      });

      try {
        const laosMintEvents = source.events.get("6283", {
          filters: {
            address: MOCK_ADDRESSES["6283"],
            topic_0: "0xa7135052b348b0b4e9943bae82d8ef1c5ac225e594ef4271d12f0744cfc98348",
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
            topic_0: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
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

        const [laosResults, polygonResults] = await Promise.all([laosMintEvents, polygonTransferEvents]);

        console.log("Fetched LAOS results:", laosResults);
        console.log("Fetched Polygon results:", polygonResults);

        if (!laosResults?.data?.length) {
          console.warn("No LAOS mint events returned.");
        }
        if (!polygonResults?.data?.length) {
          console.warn("No Polygon transfer events returned.");
        }

        // Decode LAOS events
        const decodedLaosEvents = (laosResults?.data || []).map((log) => {
          try {
            const decoded = laosInterface.parseLog({
              topics: log.topics,
              data: log.data,
            });

            return {
              chainId: "6283",
              blockNumber: log.block_number,
              blockTimestamp: log.block_timestamp,
              transactionHash: log.transaction_hash,
              event: decoded?.name,
              tokenId: decoded?.args?._tokenId.toString(),
              to: decoded?.args?._to,
              slot: decoded?.args?._slot.toString(),
              tokenURI: decoded?.args?._tokenURI,
            } as unknown as DecodedEvent;
          } catch (error) {
            console.error("Failed to decode LAOS log:", error);
            return null;
          }
        }).filter(Boolean);

        // Decode Polygon events
        const decodedPolygonEvents = (polygonResults?.data || []).map((log) => {
          try {
            const from = `0x${log.topics[1].slice(-40)}`;
            const to = `0x${log.topics[2].slice(-40)}`;
            const tokenId = BigInt(log.topics[3]).toString();

            return {
              chainId: "137",
              blockNumber: log.block_number,
              blockTimestamp: log.block_timestamp,
              transactionHash: log.transaction_hash,
              event: "Transfer",
              tokenId,
              from,
              to,
            } as unknown as DecodedEvent;
          } catch (error) {
            console.error("Failed to decode Polygon log:", error);
            return null;
          }
        }).filter(Boolean);

        // Combine all events and group by tokenId
        const allEvents = [...decodedLaosEvents, ...decodedPolygonEvents];
        console.log("Decoded events count:", allEvents.length);

        const groupedByTokenId: { [tokenId: string]: DecodedEvent[] } = {};
        allEvents.forEach((event) => {
          if (!groupedByTokenId[event.tokenId]) {
            groupedByTokenId[event.tokenId] = [];
          }
          groupedByTokenId[event.tokenId].push(event);
        });

        // Sort events within each tokenId by timestamp
        Object.values(groupedByTokenId).forEach(events => {
          events.sort((a, b) => b.blockTimestamp - a.blockTimestamp);
        });

        console.log("Final grouped response:", groupedByTokenId);

        return {
          data: {
            byTokenId: groupedByTokenId,
          },
        };

      } catch (error) {
        console.error("Error fetching events:", error);
        return { error: "Internal server error while fetching blockchain events." };
      }
    },
  });
};
