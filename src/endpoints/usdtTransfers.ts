import { Access, z } from "../lib/access/index.js";
import { Source } from "../lib/source/Source.js";
import { CombineEventsTransformation } from "../lib/transformation/CombineEventsTransformation.js";

const USDT_ADDRESSES = {
  "1": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  "137": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
};

export const registerUsdtTransfersEndpoint = (access: Access) => {
  access.registerEndpoint({
    path: "/usdt-transfers",
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
      const transformation = new CombineEventsTransformation();
      const defaultStartDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const defaultEndDate = new Date().toISOString();
      const promises = Object.entries(USDT_ADDRESSES).map(([chainId, address]) => {
        return source.events.get(chainId, {
          filters: {
            address,
            topic_0:
              "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", // Transfer(address,address,uint256)
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
      });
      const results = await Promise.all(promises);
      return transformation.transform(results);
    },
  });
};
