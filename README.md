# Geocoin Game

This project is a geocaching game that presents the player with an interactive map, allowing them to collect and deposit virtual coins.

## Features

### 1. Deterministic Cache Generation
- **Random-feeling Cache Placement**: Caches are deterministically generated around the player's initial location, based on a set of tunable parameters.
- **Cache Details**: Each cache contains a random number of coins that the player can collect. The player's inventory can also be deposited into these caches.

### 2. Player Interaction
- **Movement Controls**: The player can move in four directions (North, South, East, West) using on-screen buttons or arrow keys. Movement occurs at a fixed granularity (0.0001 degrees at a time).
- **Cache Interaction**: Players can view and interact with nearby caches. Each cache has a popup that allows the player to collect coins or deposit their inventory.
- **Automatic Cache Management**: As the player moves, caches that are outside a set visibility range are removed from the map, and new caches are generated within proximity.

### 3. Persistent Gameplay
- The game state (including player position, movement history, and inventory) is saved to local storage, allowing players to continue from where they left off even after refreshing or closing the browser.
- The player's movement history is visualized on the map with a red polyline that updates in real-time.

### 4. Real-Time Location Tracking
- Players can enable automatic geolocation updates to play the game based on their actual location. Movement updates are received via the user's device GPS.


## Prerequisites
- **Deno**: Ensure that you have [Deno](https://deno.land) installed. Deno is used as the runtime environment for the project.


## Usage
- Use terminal and nevigate to the repository and type: deno run dev


## How to Play
1. Start at the initial location centered at the Oakes College Classroom.
2. Use the movement buttons or keyboard arrow keys to navigate the map.
3. Collect coins from caches by interacting with their popups.
4. Deposit coins back into any cache to manage your inventory.
5. Track your movement history with the red line drawn on the map.
6. Use the real location feature to play based on your actual GPS location.
