import { Interface } from "ethers";
import type { Access } from "../lib/access/index.js";
import { z } from "../lib/access/index.js";
import { Source } from "../lib/source/Source.js";

const CONTRACT_ADDRESSES = {
  "6283": "0xfffffffffffffffffffffffe0000000000000119", // LAOS Mainnet GoalRev collection
  "137": "0x9f16fc5a49afa724407225e97edb8775fe4eb9fb", // Polygon GoalRev production
};

const polygonABI = [
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

const laosABI = [
  "event MintedWithExternalURI(address indexed _to, uint96 _slot, uint256 _tokenId, string _tokenURI)",
];

const polygonInterface = new Interface(polygonABI);
const laosInterface = new Interface(laosABI);

interface TokenEntry {
  chainId: string;
  collectionContract: string;
  tokenId: string;
  owner: string;
  tokenURI: string;
}

export const registerBridgelessMintingEndpoint = (access: Access) => {
  access.registerEndpoint({
    path: "/bridgeless-minting",
    method: "get",
    request: {
      query: z.object({
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
        limitPerChain: z.number().optional().default(30000),
      }),
    },
    handler: async ({ query }) => {
      const source = new Source();
      const defaultStartDate = new Date(
        Date.now() - 130 * 24 * 60 * 60 * 1000
      ).toISOString();
      const defaultEndDate = new Date().toISOString();

      try {
        const laosMintEvents = await source.events.get("6283", {
          filters: {
            address: CONTRACT_ADDRESSES["6283"],
            topic_0:
              "0xa7135052b348b0b4e9943bae82d8ef1c5ac225e594ef4271d12f0744cfc98348",
            block_timestamp: [
              { operator: "gte", value: Math.floor(new Date(query.startDate || defaultStartDate).getTime() / 1000) },
              { operator: "lte", value: Math.floor(new Date(query.endDate || defaultEndDate).getTime() / 1000) },
            ],
          },
          orderBy: { field: ["block_timestamp"], direction: "desc" },
          pagination: { limit: query.limitPerChain },
        });

        const polygonTransferEvents = await source.events.get("137", {
          filters: {
            address: CONTRACT_ADDRESSES["137"],
            topic_0:
              "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            block_timestamp: [
              { operator: "gte", value: Math.floor(new Date(query.startDate || defaultStartDate).getTime() / 1000) },
              { operator: "lte", value: Math.floor(new Date(query.endDate || defaultEndDate).getTime() / 1000) },
            ],
          },
          orderBy: { field: ["block_timestamp"], direction: "desc" },
          pagination: { limit: query.limitPerChain },
        });

        const [laosResults, polygonResults] = await Promise.all([
          laosMintEvents,
          polygonTransferEvents,
        ]);

        const tokenData: { [tokenId: string]: TokenEntry } = {};

        for (const log of laosResults?.data || []) {
          try {
            const decoded = laosInterface.parseLog({ topics: log.topics, data: log.data });
            const tokenId = decoded?.args?._tokenId.toString();
            tokenData[tokenId] = {
              chainId: "6283",
              collectionContract: CONTRACT_ADDRESSES["6283"],
              tokenId,
              owner: decoded?.args?._to,
              tokenURI: decoded?.args?._tokenURI,
            };
          } catch (error) {}
        }

        for (const log of polygonResults?.data || []) {
          try {
            const tokenId = BigInt(log.topics[3]).toString();
            const to = `0x${log.topics[2].slice(-40)}`;

            if (!tokenData[tokenId]) {
              tokenData[tokenId] = {
                chainId: "137",
                collectionContract: CONTRACT_ADDRESSES["137"],
                tokenId,
                owner: to,
                tokenURI: "",
              };
            } else {
              tokenData[tokenId] = {
                ...tokenData[tokenId],
                chainId: "137",
                collectionContract: CONTRACT_ADDRESSES["137"],
                owner: to,
                tokenURI: tokenData[tokenId].tokenURI || "",
              };
            }
          } catch (error) {}
        }

        const filteredTokenEntries = Object.values(tokenData).filter((token) => token.tokenURI !== "");

        return {
          data: {
            totalCount: filteredTokenEntries.length,
            tokens: filteredTokenEntries,
          },
        };
      } catch (error) {
        return { error: "Internal server error while fetching blockchain events." };
      }
    },
  });
};
