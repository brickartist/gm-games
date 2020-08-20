import create from "zustand";
import shallow from "zustand/shallow";
import type {
	LocalStateUI,
	GameAttributesLeagueWithHistory,
} from "../../common/types";
import safeLocalStorage from "./safeLocalStorage";

// These are variables that are needed to display parts of the UI not driven explicitly by worker/views/*.js files. Like
// the top navbar, the multi team menu, etc. They come from gameAttributes, the account system, and elsewhere.

type LocalActions = {
	mergeGames: (games: LocalStateUI["games"]) => void;
	resetLeague: () => void;
	toggleSidebar: () => void;
	update: (obj: Partial<LocalStateUI>) => void;
	updateGameAttributes: (
		gameAttributes: Partial<GameAttributesLeagueWithHistory>,
	) => void;
};

const defaultUnits: "metric" | "us" =
	window.navigator.language === "en-US" ? "us" : "metric";

// https://developer.mozilla.org/en-US/docs/Web/API/WindowEventHandlers/onbeforeunload
const blockCloseTab = (e: BeforeUnloadEvent) => {
	// Cancel the event
	e.preventDefault(); // If you prevent default behavior in Mozilla Firefox prompt will always be shown
	// Chrome requires returnValue to be set
	e.returnValue = "";
};

const [useLocal, local] = create<
	LocalStateUI & {
		actions: LocalActions;
	}
>(set => ({
	challengeNoRatings: false,
	customMenu: undefined,
	gameSimInProgress: false,
	games: [],
	gold: undefined,
	godMode: false,
	hasViewedALeague: !!safeLocalStorage.getItem("hasViewedALeague"),
	homeCourtAdvantage: 1,
	leagueName: "",
	lid: undefined,
	liveGameInProgress: false,
	phase: 0,
	phaseText: "",
	playMenuOptions: [],
	popup: window.location.search === "?w=popup",
	season: 0,
	showNagModal: false,
	sidebarOpen: false,
	startingSeason: 0,
	statusText: "Idle",
	teamInfoCache: [],
	units: defaultUnits,
	userTid: 0,
	userTids: [],
	username: undefined,
	viewInfo: undefined,
	title: undefined,
	hideNewWindow: false,
	jumpTo: false,
	jumpToSeason: undefined,
	dropdownExtraParam: undefined,
	dropdownView: undefined,
	dropdownFields: {},
	moreInfoAbbrev: undefined,
	moreInfoSeason: undefined,
	moreInfoTid: undefined,

	actions: {
		mergeGames(games: LocalStateUI["games"]) {
			set(state => {
				const newGames = state.games.slice();

				for (const game of games) {
					const index = newGames.findIndex(newGame => newGame.gid === game.gid);
					if (index >= 0) {
						newGames[index] = game;
					} else {
						newGames.push(game);
					}
				}

				return {
					games: newGames,
				};
			});
		},

		// Reset any values specific to a league
		resetLeague() {
			set({
				challengeNoRatings: false,
				games: [],
				godMode: false,
				leagueName: "",
				lid: undefined,
				liveGameInProgress: false,
				phase: 0,
				phaseText: "",
				playMenuOptions: [],
				season: 0,
				startingSeason: 0,
				statusText: "Idle",
				teamInfoCache: [],
				userTid: 0,
				userTids: [],
			});
			window.removeEventListener("beforeunload", blockCloseTab);
		},

		toggleSidebar() {
			set(state => ({ sidebarOpen: !state.sidebarOpen }));
		},

		update(obj: Partial<LocalStateUI>) {
			if (obj.hasOwnProperty("units") && obj.units === undefined) {
				obj.units = defaultUnits;
			}

			if (obj.hasOwnProperty("liveGameInProgress")) {
				if (obj.liveGameInProgress) {
					window.addEventListener("beforeunload", blockCloseTab);
				} else {
					window.removeEventListener("beforeunload", blockCloseTab);
				}
			}

			set(obj);
		},

		updateGameAttributes(
			gameAttributes: Partial<GameAttributesLeagueWithHistory>,
		) {
			const keys = [
				"challengeNoRatings",
				"godMode",
				"homeCourtAdvantage",
				"lid",
				"leagueName",
				"phase",
				"season",
				"startingSeason",
				"teamInfoCache",
				"userTid",
				"userTids",
			] as const;

			let update = false;

			const updates: Partial<GameAttributesLeagueWithHistory> = {};

			for (const key of keys) {
				if (
					gameAttributes.hasOwnProperty(key) &&
					updates[key] !== gameAttributes[key]
				) {
					// @ts-ignore
					updates[key] = gameAttributes[key];
					update = true;
				}
			}

			if (update) {
				set(state => ({ ...state, ...updates }));
			}
		},
	},
}));

const useLocalShallow = <T>(selector: (a: LocalStateUI) => T) =>
	useLocal<T>(selector, shallow);

// This assumes the actions object never changes!
const useLocalActions = () => useLocal(state => state.actions);

const localActions = local.getState().actions;

export { local, localActions, useLocal, useLocalActions, useLocalShallow };
