import { Access, z } from "../lib/access/index.js";
import { Source } from "../lib/source/Source.js";

const MOCK_ADDRESSES = {
  "6283": "0xfffffffffffffffffffffffe0000000000000119", // LAOS Mainnet address for GoalRev collection
  "137": "0x9f16fc5a49afa724407225e97edb8775fe4eb9fb", // Polygon GoalRev production address
};

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

      // Return results separately for each chain
      return {
        data: {
          laos: laosResults.data, // Mint events on LAOS
          polygon: polygonResults.data, // Transfer events on Polygon
        },
      };
    },
  });
};
