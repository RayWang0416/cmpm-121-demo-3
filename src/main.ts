// @deno-types="npm:@types/leaflet@^1.9.14"
import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css";
import "./style.css";

// Fix missing marker images
import "./leafletWorkaround.ts";

// Deterministic random number generator
import luck from "./luck.ts";

// Location of our classroom (as identified on Google Maps)
const OAKES_CLASSROOM = leaflet.latLng(36.98949379578401, -122.06277128548504);

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;

// Create the map (element with id "map" is defined in index.html)
const map = leaflet.map(document.getElementById("map")!, {
  center: OAKES_CLASSROOM,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: false,
});

// Populate the map with a background tile layer
leaflet
  .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  })
  .addTo(map);

// Add a marker to represent the player
const playerMarker = leaflet.marker(OAKES_CLASSROOM);
playerMarker.bindTooltip("That's you!");
playerMarker.addTo(map);

// Display the player's points
let playerPoints = 0;
const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!; // element `statusPanel` is defined in index.html
statusPanel.innerHTML = "No points yet...";

// Add caches to the map by cell numbers
// Add global variable for the player's coin inventory
let playerInventory = 0;

// Store cache data globally to maintain state
const cacheData: Record<string, number> = {};

// Modify spawnCache to include collect and deposit features
function spawnCache(i: number, j: number) {
  // Convert cell numbers into lat/lng bounds
  const origin = OAKES_CLASSROOM;
  const bounds = leaflet.latLngBounds([
    [origin.lat + i * TILE_DEGREES, origin.lng + j * TILE_DEGREES],
    [origin.lat + (i + 1) * TILE_DEGREES, origin.lng + (j + 1) * TILE_DEGREES],
  ]);

  // Add a rectangle to the map to represent the cache
  const rect = leaflet.rectangle(bounds);
  rect.addTo(map);

  // Generate a unique key for the cache based on its coordinates
  const cacheKey = `${i},${j}`;

  // Initialize coin count for the cache if not already set
  if (!(cacheKey in cacheData)) {
    cacheData[cacheKey] = Math.floor(luck([i, j, "initialValue"].toString()) * 10);
  }

  // Handle interactions with the cache
  rect.bindPopup(() => {
    // Use the existing coin count from cacheData
    let coinCount = cacheData[cacheKey];

    // The popup offers a description and buttons
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `
                <div>Cache at "${i},${j}". Coins: <span id="coins">${coinCount}</span></div>
                <button id="collect">Collect</button>
                <button id="deposit">Deposit</button>`;

    // Collect button: Transfer coins from cache to player inventory
    popupDiv
      .querySelector<HTMLButtonElement>("#collect")!
      .addEventListener("click", () => {
        if (coinCount > 0) {
          coinCount--;
          playerInventory++;
          cacheData[cacheKey] = coinCount;
          popupDiv.querySelector<HTMLSpanElement>("#coins")!.innerHTML =
            coinCount.toString();
          statusPanel.innerHTML = `Player Inventory: ${playerInventory} coins`;
        }
      });

    // Deposit button: Transfer coins from player inventory to cache
    popupDiv
      .querySelector<HTMLButtonElement>("#deposit")!
      .addEventListener("click", () => {
        if (playerInventory > 0) {
          coinCount++;
          playerInventory--;
          cacheData[cacheKey] = coinCount;
          popupDiv.querySelector<HTMLSpanElement>("#coins")!.innerHTML =
            coinCount.toString();
          statusPanel.innerHTML = `Player Inventory: ${playerInventory} coins`;
        }
      });

    return popupDiv;
  });
}

// Look around the player's neighborhood for caches to spawn
for (let i = -NEIGHBORHOOD_SIZE; i < NEIGHBORHOOD_SIZE; i++) {
  for (let j = -NEIGHBORHOOD_SIZE; j < NEIGHBORHOOD_SIZE; j++) {
    // If location i,j is lucky enough, spawn a cache!
    if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
      spawnCache(i, j);
    }
  }
}

// Implement player movement with arrow keys and update player's location
const MOVEMENT_STEP = TILE_DEGREES;
window.addEventListener("keydown", (event) => {
  let newLat = playerMarker.getLatLng().lat;
  let newLng = playerMarker.getLatLng().lng;

  switch (event.key) {
    case "ArrowUp":
      newLat += MOVEMENT_STEP;
      break;
    case "ArrowDown":
      newLat -= MOVEMENT_STEP;
      break;
    case "ArrowLeft":
      newLng -= MOVEMENT_STEP;
      break;
    case "ArrowRight":
      newLng += MOVEMENT_STEP;
      break;
    default:
      return; // Ignore other keys
  }

  const newPosition = leaflet.latLng(newLat, newLng);
  playerMarker.setLatLng(newPosition);
  map.panTo(newPosition);

  statusPanel.innerHTML = `Player moved to: ${newLat.toFixed(5)}, ${newLng.toFixed(5)}`;
});
