import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import Phaser from "phaser";
import GameManager from "#app/test/utils/gameManager";
import Overrides from "#app/overrides";
import {
  CommandPhase,
  EnemyCommandPhase,
  TurnInitPhase,
} from "#app/phases";
import {Mode} from "#app/ui/ui";
import {getMovePosition} from "#app/test/utils/gameManagerUtils";
import {Command} from "#app/ui/command-ui-handler";
import {BattleStat} from "#app/data/battle-stat";
import { Abilities } from "#enums/abilities";
import { Moves } from "#enums/moves";
import { Species } from "#enums/species";


describe("Moves - Tail whip", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  afterEach(() => {
    game.phaseInterceptor.restoreOg();
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    const moveToUse = Moves.TAIL_WHIP;
    vi.spyOn(Overrides, "BATTLE_TYPE_OVERRIDE", "get").mockReturnValue("single");
    vi.spyOn(Overrides, "OPP_SPECIES_OVERRIDE", "get").mockReturnValue(Species.RATTATA);
    vi.spyOn(Overrides, "OPP_ABILITY_OVERRIDE", "get").mockReturnValue(Abilities.INSOMNIA);
    vi.spyOn(Overrides, "ABILITY_OVERRIDE", "get").mockReturnValue(Abilities.INSOMNIA);
    vi.spyOn(Overrides, "STARTING_LEVEL_OVERRIDE", "get").mockReturnValue(2000);
    vi.spyOn(Overrides, "MOVESET_OVERRIDE", "get").mockReturnValue([moveToUse]);
    vi.spyOn(Overrides, "OPP_MOVESET_OVERRIDE", "get").mockReturnValue([Moves.TACKLE,Moves.TACKLE,Moves.TACKLE,Moves.TACKLE]);
  });

  it("TAIL_WHIP", async() => {
    const moveToUse = Moves.TAIL_WHIP;
    await game.startBattle([
      Species.MIGHTYENA,
      Species.MIGHTYENA,
    ]);

    let battleStatsOpponent = game.scene.currentBattle.enemyParty[0].summonData.battleStats;
    expect(battleStatsOpponent[BattleStat.DEF]).toBe(0);

    game.onNextPrompt("CommandPhase", Mode.COMMAND, () => {
      game.scene.ui.setMode(Mode.FIGHT, (game.scene.getCurrentPhase() as CommandPhase).getFieldIndex());
    });
    game.onNextPrompt("CommandPhase", Mode.FIGHT, () => {
      const movePosition = getMovePosition(game.scene, 0, moveToUse);
      (game.scene.getCurrentPhase() as CommandPhase).handleCommand(Command.FIGHT, movePosition, false);
    });
    await game.phaseInterceptor.runFrom(EnemyCommandPhase).to(TurnInitPhase);
    battleStatsOpponent = game.scene.currentBattle.enemyParty[0].summonData.battleStats;
    expect(battleStatsOpponent[BattleStat.DEF]).toBe(-1);
  }, 20000);
});
