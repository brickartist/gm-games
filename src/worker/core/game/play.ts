import { PHASE, PLAYER, TIME_BETWEEN_GAMES } from "../../../common";
import {
	GameSim,
	allStar,
	finances,
	freeAgents,
	phase,
	player,
	season,
	team,
	trade,
} from "..";
import loadTeams from "./loadTeams";
import updatePlayoffSeries from "./updatePlayoffSeries";
import writeGameStats from "./writeGameStats";
import writePlayerStats from "./writePlayerStats";
import writeTeamStats from "./writeTeamStats";
import { idb } from "../../db";
import {
	advStats,
	g,
	helpers,
	lock,
	logEvent,
	toUI,
	updatePlayMenu,
	updateStatus,
	recomputeLocalUITeamOvrs,
} from "../../util";
import type {
	Conditions,
	ScheduleGame,
	UpdateEvents,
} from "../../../common/types";

/**
 * Play one or more days of games.
 *
 * This also handles the case where there are no more games to be played by switching the phase to either the playoffs or before the draft, as appropriate.
 *
 * @memberOf core.game
 * @param {number} numDays An integer representing the number of days to be simulated. If numDays is larger than the number of days remaining, then all games will be simulated up until either the end of the regular season or the end of the playoffs, whichever happens first.
 * @param {boolean} start Is this a new request from the user to play games (true) or a recursive callback to simulate another day (false)? If true, then there is a check to make sure simulating games is allowed. Default true.
 * @param {number?} gidPlayByPlay If this number matches a game ID number, then an array of strings representing the play-by-play game simulation are included in the api.realtimeUpdate raw call.
 */
const play = async (
	numDays: number,
	conditions: Conditions,
	start: boolean = true,
	gidPlayByPlay?: number,
) => {
	// This is called when there are no more games to play, either due to the user's request (e.g. 1 week) elapsing or at the end of the regular season
	const cbNoGames = async (playoffsOver: boolean = false) => {
		await updateStatus("Saving...");
		await idb.cache.flush();
		await updateStatus("Idle");
		await lock.set("gameSim", false);

		// Check to see if the season is over
		if (g.get("phase") < PHASE.PLAYOFFS) {
			const schedule = await season.getSchedule();

			if (schedule.length === 0) {
				await phase.newPhase(
					PHASE.PLAYOFFS,
					conditions,
					gidPlayByPlay !== undefined,
				);
			} else {
				const allStarNext = await allStar.nextGameIsAllStar(schedule);

				if (allStarNext && gidPlayByPlay === undefined) {
					toUI(
						"realtimeUpdate",
						[[], helpers.leagueUrl(["all_star_draft"])],
						conditions,
					);
				}
			}
		} else if (playoffsOver) {
			await phase.newPhase(
				PHASE.DRAFT_LOTTERY,
				conditions,
				gidPlayByPlay !== undefined,
			);
		}

		await updatePlayMenu();
	};

	// Saves a vector of results objects for a day, as is output from cbSimGames
	const cbSaveResults = async (results: any[], dayOver: boolean) => {
		// Before writeGameStats, so LeagueTopBar can not update with game result
		if (gidPlayByPlay !== undefined) {
			await toUI("updateLocal", [{ liveGameInProgress: true }]);
		}

		// Before writeGameStats, so injury is set correctly
		const {
			injuryTexts,
			pidsInjuredOneGameOrLess,
			stopPlay,
		} = await writePlayerStats(results, conditions);

		const gidsFinished = await Promise.all(
			results.map(async result => {
				const att = await writeTeamStats(result);
				await writeGameStats(result, att, conditions);
				return result.gid;
			}),
		);

		// Update clinchedPlayoffs
		if (g.get("phase") === PHASE.REGULAR_SEASON) {
			await team.updateClinchedPlayoffs(false, conditions);
		}

		// Update playoff series W/L
		if (g.get("phase") === PHASE.PLAYOFFS) {
			await updatePlayoffSeries(results, conditions);
		}

		// Delete finished games from schedule
		for (const gid of gidsFinished) {
			if (typeof gid === "number") {
				await idb.cache.schedule.delete(gid);
			}
		}

		if (injuryTexts.length > 0) {
			logEvent(
				{
					type: "injuredList",
					text: injuryTexts.join("<br>"),
					showNotification: true,
					persistent: stopPlay,
					saveToDb: false,
				},
				conditions,
			);
		}

		const updateEvents: UpdateEvents = ["gameSim"];

		if (dayOver) {
			// Update ranks
			await finances.updateRanks(["expenses", "revenues"]);

			const healedTexts: string[] = [];

			// Injury countdown - This must be after games are saved, of there is a race condition involving new injury assignment in writeStats
			const players = await idb.cache.players.indexGetAll("playersByTid", [
				PLAYER.FREE_AGENT,
				Infinity,
			]);

			for (const p of players) {
				let changed = false;

				if (p.injury.gamesRemaining > 0) {
					p.injury.gamesRemaining -= 1;
					changed = true;
				}

				// Is it already over?
				if (p.injury.type !== "Healthy" && p.injury.gamesRemaining <= 0) {
					const score = p.injury.score;
					p.injury = {
						type: "Healthy",
						gamesRemaining: 0,
					};
					changed = true;
					const healedText = `${
						p.ratings[p.ratings.length - 1].pos
					} <a href="${helpers.leagueUrl(["player", p.pid])}">${p.firstName} ${
						p.lastName
					}</a>`;

					if (
						p.tid === g.get("userTid") &&
						!pidsInjuredOneGameOrLess.has(p.pid)
					) {
						healedTexts.push(healedText);
					}

					logEvent(
						{
							type: "healed",
							text: `${healedText} has recovered from his injury.`,
							showNotification: false,
							pids: [p.pid],
							tids: [p.tid],
							score,
						},
						conditions,
					);
				}

				// Also check for gamesUntilTradable
				if (!p.hasOwnProperty("gamesUntilTradable")) {
					p.gamesUntilTradable = 0; // Initialize for old leagues

					changed = true;
				} else if (p.gamesUntilTradable > 0) {
					p.gamesUntilTradable -= 1;
					changed = true;
				}

				if (changed) {
					await idb.cache.players.put(p);
				}
			}

			if (healedTexts.length > 0) {
				logEvent(
					{
						type: "healedList",
						text: healedTexts.join("<br>"),
						showNotification: true,
						saveToDb: false,
					},
					conditions,
				);
			}

			// Tragic deaths only happen during the regular season!
			if (
				g.get("phase") !== PHASE.PLAYOFFS &&
				Math.random() < g.get("tragicDeathRate")
			) {
				await player.killOne(conditions);

				if (g.get("stopOnInjury")) {
					await lock.set("stopGameSim", true);
				}

				updateEvents.push("playerMovement");
			}
		}

		// More stuff for LeagueTopBar - update ovrs based on injuries
		await recomputeLocalUITeamOvrs();

		await advStats();

		const playoffsOver =
			g.get("phase") === PHASE.PLAYOFFS &&
			(await season.newSchedulePlayoffsDay());

		let raw;
		let url;

		// If there was a play by play done for one of these games, get it
		if (gidPlayByPlay !== undefined) {
			for (let i = 0; i < results.length; i++) {
				if (results[i].playByPlay !== undefined) {
					raw = {
						gidPlayByPlay,
						playByPlay: results[i].playByPlay,
					};
					url = helpers.leagueUrl(["live_game"]);
				}
			}

			// This is not ideal... it means no event will be sent to other open tabs. But I don't have a way of saying "send this update to all tabs except X" currently
			await toUI("realtimeUpdate", [updateEvents, url, raw], conditions);
		} else {
			url = undefined;
			await toUI("realtimeUpdate", [updateEvents]);
		}

		if (numDays - 1 <= 0 || playoffsOver) {
			await cbNoGames(playoffsOver);
		} else {
			await play(numDays - 1, conditions, false);
		}
	};

	// Simulates a day of games (whatever is in schedule) and passes the results to cbSaveResults
	const cbSimGames = async (
		schedule: (ScheduleGame & { gid: number })[],
		teams: Record<number, any>,
		dayOver: boolean,
	) => {
		const results: any[] = [];

		for (let i = 0; i < schedule.length; i++) {
			const doPlayByPlay = gidPlayByPlay === schedule[i].gid;
			const gs = new GameSim(
				schedule[i].gid,
				teams[schedule[i].homeTid],
				teams[schedule[i].awayTid],
				doPlayByPlay,
			);
			results.push(gs.run());
		}

		await cbSaveResults(results, dayOver);
	};

	// Simulates a day of games. If there are no games left, it calls cbNoGames.
	// Promise is resolved after games are run
	const cbPlayGames = async () => {
		if (numDays === 1) {
			await updateStatus(`Playing (1 ${TIME_BETWEEN_GAMES} left)`);
		} else {
			await updateStatus(`Playing (${numDays} ${TIME_BETWEEN_GAMES}s left)`);
		}

		let schedule = await season.getSchedule(true);

		// If live game sim, only do that one game, not the whole day
		let dayOver = true;
		if (gidPlayByPlay !== undefined) {
			const lengthBefore = schedule.length;
			schedule = schedule.filter(game => game.gid === gidPlayByPlay);
			const lengthAfter = schedule.length;

			if (lengthBefore - lengthAfter > 0) {
				dayOver = false;
			}
		}

		// This should also call cbNoGames after the playoffs end, because g.get("phase") will have been incremented by season.newSchedulePlayoffsDay after the previous day's games
		if (schedule.length === 0 && g.get("phase") !== PHASE.PLAYOFFS) {
			return cbNoGames();
		}

		const tids = new Set<number>();

		for (const matchup of schedule) {
			tids.add(matchup.homeTid);
			tids.add(matchup.awayTid);
		}

		const teams = await loadTeams(Array.from(tids)); // Play games

		// Will loop through schedule and simulate all games
		if (schedule.length === 0 && g.get("phase") === PHASE.PLAYOFFS) {
			// Sometimes the playoff schedule isn't made the day before, so make it now
			// This works because there should always be games in the playoffs phase. The next phase will start before reaching this point when the playoffs are over.
			await season.newSchedulePlayoffsDay();
			schedule = await season.getSchedule(true);
		}

		await cbSimGames(schedule, teams, dayOver);
	};

	// This simulates a day, including game simulation and any other bookkeeping that needs to be done
	const cbRunDay = async () => {
		const userTeamSizeError = await team.checkRosterSizes();

		if (!userTeamSizeError) {
			await updatePlayMenu();

			if (numDays > 0) {
				// If we didn't just stop games, let's play
				// Or, if we are starting games (and already passed the lock), continue even if stopGameSim was just seen
				const stopGameSim = lock.get("stopGameSim");

				if (start || !stopGameSim) {
					// If start is set, then reset stopGames
					if (stopGameSim) {
						await lock.set("stopGameSim", false);
					}

					if (g.get("phase") !== PHASE.PLAYOFFS) {
						await freeAgents.decreaseDemands();
						await freeAgents.autoSign();

						await trade.betweenAiTeams();
					}

					await cbPlayGames();
				} else {
					// Update UI if stopped
					await cbNoGames();
				}
			} else {
				// Not sure why we get here sometimes, but we do
				const playoffsOver =
					g.get("phase") === PHASE.PLAYOFFS &&
					(await season.newSchedulePlayoffsDay());
				await cbNoGames(playoffsOver);
			}
		} else {
			await lock.set("gameSim", false); // Counteract auto-start in lock.canStartGames
			await updatePlayMenu();
			await updateStatus("Idle");
			logEvent(
				{
					type: "error",
					text: userTeamSizeError,
					saveToDb: false,
				},
				conditions,
			);
		}
	};

	// If this is a request to start a new simulation... are we allowed to do
	// that? If so, set the lock and update the play menu
	if (start) {
		const canStartGames = await lock.canStartGames();

		if (canStartGames) {
			await cbRunDay();
		}
	} else {
		await cbRunDay();
	}
};

export default play;
