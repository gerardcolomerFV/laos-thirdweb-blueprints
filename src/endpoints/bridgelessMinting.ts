import { Access, z } from "../lib/access/index.js";
import { Source } from "../lib/source/Source.js";
import { Interface, Log } from "ethers";

const CONTRACT_ADDRESSES = {
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
      const defaultStartDate = new Date(Date.now() - 130 * 24 * 60 * 60 * 1000).toISOString(); // 130 Days ago
      const defaultEndDate = new Date().toISOString();

      console.log("Fetching events from Thirdweb...");
      console.log("Query Parameters:", {
        startDate: query.startDate || defaultStartDate,
        endDate: query.endDate || defaultEndDate,
        limitPerChain: query.limitPerChain,
      });

      try {
        let latestBlockWithEvent = { "6283": 0, "137": 0 }; // Track latest blocks where an event occurred

        // Fetch latest indexed block by querying the latest event
        async function getLatestIndexedBlock(chainId: string) {
          const latestEvent = await source.events.get(chainId, {
            orderBy: { field: ["block_number"], direction: "desc" },
            pagination: { limit: 1 },
          });

          if (latestEvent?.data?.length) {
            return latestEvent.data[0].block_number;
          }
          return 0;
        }

        const latestBlockIndexed = {
          "6283": await getLatestIndexedBlock("6283"),
          "137": await getLatestIndexedBlock("137"),
        };

        console.log(`Latest indexed block on LAOS: ${latestBlockIndexed["6283"]}`);
        console.log(`Latest indexed block on Polygon: ${latestBlockIndexed["137"]}`);

        const laosMintEvents = await source.events.get("6283", {
          filters: {
            address: CONTRACT_ADDRESSES["6283"],
            topic_0: "0xa7135052b348b0b4e9943bae82d8ef1c5ac225e594ef4271d12f0744cfc98348",
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
            topic_0: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            block_timestamp: [
              { operator: "gte", value: Math.floor(new Date(query.startDate || defaultStartDate).getTime() / 1000) },
              { operator: "lte", value: Math.floor(new Date(query.endDate || defaultEndDate).getTime() / 1000) },
            ],
          },
          orderBy: { field: ["block_timestamp"], direction: "desc" },
          pagination: { limit: query.limitPerChain },
        });

        const [laosResults, polygonResults] = await Promise.all([laosMintEvents, polygonTransferEvents]);

        if (!laosResults?.data?.length) console.warn("No LAOS mint events returned.");
        if (!polygonResults?.data?.length) console.warn("No Polygon transfer events returned.");

        // Track the highest block number with an event
        if (laosResults?.data?.length) {
          latestBlockWithEvent["6283"] = Math.max(...laosResults.data.map((log) => log.block_number));
        }
        if (polygonResults?.data?.length) {
          latestBlockWithEvent["137"] = Math.max(...polygonResults.data.map((log) => log.block_number));
        }

        console.log(`Latest block with event on LAOS: ${latestBlockWithEvent["6283"]}`);
        console.log(`Latest block with event on Polygon: ${latestBlockWithEvent["137"]}`);

        // Process LAOS Mint Events (to get the tokenURI)
        const tokenData: { [tokenId: string]: TokenEntry } = {};

        (laosResults?.data || []).forEach((log) => {
          try {
            const decoded = laosInterface.parseLog({
              topics: log.topics,
              data: log.data,
            });

            const tokenId = decoded?.args?._tokenId.toString();
            tokenData[tokenId] = {
              chainId: "6283",
              collectionContract: CONTRACT_ADDRESSES["6283"], // Default to LAOS contract
              tokenId,
              owner: decoded?.args?._to, // Initial owner
              tokenURI: decoded?.args?._tokenURI,
            };
          } catch (error) {
            console.error("Failed to decode LAOS log:", error);
          }
        });

        // Process Polygon Transfer Events (to update chain & owner)
        (polygonResults?.data || []).forEach((log) => {
          try {
            const tokenId = BigInt(log.topics[3]).toString();
            const to = `0x${log.topics[2].slice(-40)}`;

            if (!tokenData[tokenId]) {
              // If we haven't seen this token in LAOS, initialize with Polygon contract
              tokenData[tokenId] = {
                chainId: "137",
                collectionContract: CONTRACT_ADDRESSES["137"], // Polygon contract
                tokenId,
                owner: to,
                tokenURI: "", // No tokenURI yet
              };
            } else {
              // Update existing entry to reflect latest transfer
              tokenData[tokenId].chainId = "137";
              tokenData[tokenId].collectionContract = CONTRACT_ADDRESSES["137"]; // Update to Polygon contract
              tokenData[tokenId].owner = to;
            }
          } catch (error) {
            console.error("Failed to decode Polygon log:", error);
          }
        });

        // Convert the final result into an array
        const tokenEntries = Object.values(tokenData);

        console.log(`Final token entries count: ${tokenEntries.length}`);

        return {
          data: {
            totalCount: tokenEntries.length,
            tokens: tokenEntries,
          },
        };
      } catch (error) {
        console.error("Error fetching events:", error);
        return { error: "Internal server error while fetching blockchain events." };
      }
    },
  });
};
