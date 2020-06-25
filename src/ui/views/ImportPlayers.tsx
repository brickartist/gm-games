import React, { useState } from "react";
import { PLAYER } from "../../common";
import useTitleBar from "../hooks/useTitleBar";
import { getCols, helpers, toWorker, downloadFile, useLocal } from "../util";
import { DataTable, PlayerNameLabels, LeagueFileUpload } from "../components";
import type { View } from "../../common/types";

const ImportPlayers = ({
	challengeNoRatings,
	currentSeason,
}: View<"importPlayers">) => {
	const [status, setStatus] = useState<undefined | "loading" | "importing">();
	const [leagueFile, setLeagueFile] = useState<{
		startingSeason?: number;
		version?: number;
	}>({});
	const [players, setPlayers] = useState<
		{
			p: any;
			contractAmount: string;
			contractExp: string;
			draftYear: string;
			season: string;
			tid: number;
		}[]
	>([]);

	const teamInfoCache = useLocal(state => state.teamInfoCache);

	useTitleBar({
		title: "Import Players",
		dropdownView: "import_players",
	});

	const cols = getCols(
		"",
		"#",
		"Name",
		"Pos",
		"Ovr",
		"Pot",
		"Age",
		"Team",
		"Contract",
		"Exp",
	);
	cols[2].width = "100%";

	const rows = players.map((player, i) => {
		const { p, contractAmount, contractExp, draftYear, season, tid } = player;

		const showRatings = !challengeNoRatings;

		// const abbrev = helpers.getAbbrev(tid, teamInfoCache);

		const seasonInt = parseInt(season);

		let ratings = p.ratings[p.ratings.length - 1];
		if (p.ratings.length > 0) {
			for (let i = p.ratings.length - 1; i--; i >= 0) {
				if (p.ratings[i].season === seasonInt) {
					ratings = p.ratings[i];
					break;
				}
			}
		}

		const name = `${p.firstName} ${p.lastName}`;

		return {
			key: p.pid,
			data: [
				<input
					type="checkbox"
					title="Import player"
					checked={false}
					disabled={!!status}
					onChange={() => {
						// handleToggle(userOrOther, "player", "include", p.pid);
					}}
				/>,
				i + 1,
				<PlayerNameLabels injury={p.injury} skills={ratings.skills}>
					{name}
				</PlayerNameLabels>,
				ratings.pos,
				showRatings ? ratings.ovr : null,
				showRatings ? ratings.pot : null,
				"Age",
				"Team",
				"Contract",
				"Exp",
			],
		};
	});

	return (
		<>
			<p>
				More: <a href={helpers.leagueUrl(["export_players"])}>Export Players</a>{" "}
				| <a href={helpers.leagueUrl(["export_league"])}>Export League</a>
			</p>

			<LeagueFileUpload
				disabled={!!status}
				onLoading={() => {
					setStatus("loading");
				}}
				onDone={async (error, leagueFile) => {
					if (error) {
						return;
					}

					console.log(leagueFile);

					setLeagueFile({
						startingSeason: leagueFile.startingSeason,
						version: leagueFile.version,
					});

					leagueFile.players = leagueFile.players ? leagueFile.players : [];

					const players = leagueFile.players.map((p: any) => {
						const exportedSeason: number | undefined =
							typeof p.exportedSeason === "number"
								? p.exportedSeason
								: undefined;

						const season =
							exportedSeason !== undefined
								? p.exportedSeason
								: p.ratings[p.ratings.length - 1].season;

						let tid;
						if (
							Array.isArray(p.stats) &&
							p.stats.length > 0 &&
							exportedSeason !== undefined
						) {
							for (let i = p.stats.length - 1; i--; i >= 0) {
								const ps = p.stats[i];
								if (ps.season === p.exportedSeason) {
									if (ps.tid < teamInfoCache.length) {
										tid = ps.tid;
									}
									break;
								}
							}
						}
						if (typeof tid !== "number") {
							tid = p.tid;
						}

						let contractAmount = 1;
						let contractExp = season + 1;
						if (exportedSeason === season) {
							contractAmount = p.contract.amount;
							contractExp = p.contract.exp;
						} else {
							const salaryRow = Array.isArray(p.salaries)
								? p.salaries.find((row: any) => row.season === season)
								: undefined;
							if (salaryRow) {
								contractAmount = salaryRow.amount;
							}
						}

						const draftYear = p.draft.year;

						const seasonOffset = currentSeason - season;
						console.log(seasonOffset, currentSeason, season);

						return {
							p,
							contractAmount: String(contractAmount),
							contractExp: String(contractExp + seasonOffset),
							draftYear: String(draftYear + seasonOffset),
							season: String(season + seasonOffset),
							tid,
						};
					});

					console.log(players);

					setPlayers(players);

					setStatus(undefined);
				}}
			/>

			{rows.length > 0 ? (
				<>
					<div className="clearfix">
						<DataTable
							cols={cols}
							defaultSort={[1, "asc"]}
							name="ImportPlayers"
							pagination
							rows={rows}
						/>
					</div>

					<button
						className="btn btn-lg btn-primary my-3"
						disabled={!!status}
						onClick={async () => {
							setStatus("importing");

							setStatus(undefined);
						}}
					>
						Import Players
					</button>
				</>
			) : null}
		</>
	);
};

export default ImportPlayers;