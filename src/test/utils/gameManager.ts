import GameWrapper from "#app/test/utils/gameWrapper";
import {Mode} from "#app/ui/ui";
import {generateStarter, waitUntil} from "#app/test/utils/gameManagerUtils";
import {
  CommandPhase,
  DamagePhase,
  EncounterPhase,
  FaintPhase,
  LoginPhase, NewBattlePhase,
  SelectGenderPhase,
  SelectStarterPhase,
  TitlePhase, TurnInitPhase,
} from "#app/phases";
import BattleScene from "#app/battle-scene.js";
import PhaseInterceptor from "#app/test/utils/phaseInterceptor";
import TextInterceptor from "#app/test/utils/TextInterceptor";
import {GameModes, getGameMode} from "#app/game-mode";
import fs from "fs";
import {AES, enc} from "crypto-js";
import {updateUserInfo} from "#app/account";
import {Species} from "#app/data/enums/species";
import {PlayerGender} from "#app/data/enums/player-gender";
import {GameDataType} from "#app/data/enums/game-data-type";
import InputsHandler from "#app/test/utils/inputsHandler";
import {ExpNotification} from "#app/enums/exp-notification";
import ErrorInterceptor from "#app/test/utils/errorInterceptor";
import {EnemyPokemon, PlayerPokemon} from "#app/field/pokemon";
import {MockClock} from "#app/test/utils/mocks/mockClock";
import {Command} from "#app/ui/command-ui-handler";
import ModifierSelectUiHandler from "#app/ui/modifier-select-ui-handler";
import {Button} from "#app/enums/buttons";

/**
 * Class to manage the game state and transitions between phases.
 */
export default class GameManager {
  public gameWrapper: GameWrapper;
  public scene: BattleScene;
  public phaseInterceptor: PhaseInterceptor;
  public textInterceptor: TextInterceptor;
  public inputsHandler: InputsHandler;

  /**
   * Creates an instance of GameManager.
   * @param phaserGame - The Phaser game instance.
   * @param bypassLogin - Whether to bypass the login phase.
   */
  constructor(phaserGame: Phaser.Game, bypassLogin: boolean = true) {
    localStorage.clear();
    ErrorInterceptor.getInstance().clear();
    BattleScene.prototype.randBattleSeedInt = (arg) => arg-1;
    this.gameWrapper = new GameWrapper(phaserGame, bypassLogin);
    this.scene = new BattleScene();
    this.phaseInterceptor = new PhaseInterceptor(this.scene);
    this.textInterceptor = new TextInterceptor(this.scene);
    this.gameWrapper.setScene(this.scene);
  }

  /**
   * Sets the game mode.
   * @param mode - The mode to set.
   */
  setMode(mode: Mode) {
    this.scene.ui?.setMode(mode);
  }

  /**
   * Waits until the specified mode is set.
   * @param mode - The mode to wait for.
   * @returns A promise that resolves when the mode is set.
   */
  waitMode(mode: Mode): Promise<void> {
    return new Promise(async (resolve) => {
      await waitUntil(() => this.scene.ui?.getMode() === mode);
      return resolve();
    });
  }

  /**
   * Ends the current phase.
   */
  endPhase() {
    this.scene.getCurrentPhase().end();
  }

  /**
   * Adds an action to be executed on the next prompt.
   * @param phaseTarget - The target phase.
   * @param mode - The mode to wait for.
   * @param callback - The callback to execute.
   * @param expireFn - Optional function to determine if the prompt has expired.
   */
  onNextPrompt(phaseTarget: string, mode: Mode, callback: () => void, expireFn?: () => void, awaitingActionInput: boolean = false) {
    this.phaseInterceptor.addToNextPrompt(phaseTarget, mode, callback, expireFn, awaitingActionInput);
  }

  /**
   * Runs the game to the title phase.
   * @returns A promise that resolves when the title phase is reached.
   */
  runToTitle(): Promise<void> {
    return new Promise(async(resolve, reject) => {
      await this.phaseInterceptor.run(LoginPhase).catch((e) => reject(e));
      this.onNextPrompt("SelectGenderPhase", Mode.OPTION_SELECT, () => {
        this.scene.gameData.gender = PlayerGender.MALE;
        this.endPhase();
      }, () => this.isCurrentPhase(TitlePhase));
      await this.phaseInterceptor.run(SelectGenderPhase, () => this.isCurrentPhase(TitlePhase)).catch((e) => reject(e));
      await this.phaseInterceptor.run(TitlePhase).catch((e) => reject(e));
      this.scene.gameSpeed = 5;
      this.scene.moveAnimations = false;
      this.scene.showLevelUpStats = false;
      this.scene.expGainsSpeed = 3;
      this.scene.expParty = ExpNotification.SKIP;
      this.scene.hpBarSpeed = 3;
      resolve();
    });
  }

  /**
   * Runs the game to the summon phase.
   * @param species - Optional array of species to summon.
   * @returns A promise that resolves when the summon phase is reached.
   */
  runToSummon(species?: Species[]): Promise<void> {
    return new Promise(async(resolve, reject) => {
      await this.runToTitle().catch((e) => reject(e));
      this.onNextPrompt("TitlePhase", Mode.TITLE, () => {
        this.scene.gameMode = getGameMode(GameModes.CLASSIC);
        const starters = generateStarter(this.scene, species);
        const selectStarterPhase = new SelectStarterPhase(this.scene);
        this.scene.pushPhase(new EncounterPhase(this.scene, false));
        selectStarterPhase.initBattle(starters);
      });
      await this.phaseInterceptor.run(EncounterPhase).catch((e) => reject(e));
      resolve();
    });
  }

  /**
   * Starts a battle.
   * @param species - Optional array of species to start the battle with.
   * @returns A promise that resolves when the battle is started.
   */
  startBattle(species?: Species[]): Promise<void> {
    return new Promise(async(resolve, reject) => {
      await this.runToSummon(species).catch((e) => reject(e));
      this.onNextPrompt("CheckSwitchPhase", Mode.CONFIRM, () => {
        this.setMode(Mode.MESSAGE);
        this.endPhase();
      }, () => this.isCurrentPhase(CommandPhase) || this.isCurrentPhase(TurnInitPhase));
      this.onNextPrompt("CheckSwitchPhase", Mode.CONFIRM, () => {
        this.setMode(Mode.MESSAGE);
        this.endPhase();
      }, () => this.isCurrentPhase(CommandPhase) || this.isCurrentPhase(TurnInitPhase));
      await this.phaseInterceptor.to(CommandPhase).catch((e) => reject(e));
      console.log("==================[New Turn]==================");
      return resolve();
    });
  }

  doAttack(moveIndex: integer): Promise<void> {
    this.onNextPrompt("CommandPhase", Mode.COMMAND, () => {
      this.scene.ui.setMode(Mode.FIGHT, (this.scene.getCurrentPhase() as CommandPhase).getFieldIndex());
    });
    this.onNextPrompt("CommandPhase", Mode.FIGHT, () => {
      (this.scene.getCurrentPhase() as CommandPhase).handleCommand(Command.FIGHT, moveIndex, false);
    });
    return this.phaseInterceptor.to(DamagePhase);
  }

  doKillOpponents() {
    return new Promise<void>(async(resolve, reject) => {
      await this.killPokemon(this.scene.currentBattle.enemyParty[0]).catch((e) => reject(e));
      if (this.scene.currentBattle.double) {
        await this.killPokemon(this.scene.currentBattle.enemyParty[1]).catch((e) => reject(e));
      }
      return resolve();
    });
  }

  toNextTurn(): Promise<void> {
    return new Promise<void>(async(resolve, reject) => {
      await this.phaseInterceptor.to(CommandPhase).catch((e) => reject(e));
      return resolve();
    });
  }

  toNextWave(): Promise<void> {
    return new Promise<void>(async(resolve, reject) => {
      this.onNextPrompt("SelectModifierPhase", Mode.MODIFIER_SELECT, () => {
        const handler = this.scene.ui.getHandler() as ModifierSelectUiHandler;
        handler.processInput(Button.CANCEL);
      }, () => this.isCurrentPhase(CommandPhase) || this.isCurrentPhase(NewBattlePhase), true);
      this.onNextPrompt("SelectModifierPhase", Mode.CONFIRM, () => {
        const handler = this.scene.ui.getHandler() as ModifierSelectUiHandler;
        handler.processInput(Button.ACTION);
      }, () => this.isCurrentPhase(CommandPhase) || this.isCurrentPhase(NewBattlePhase));
      this.onNextPrompt("CheckSwitchPhase", Mode.CONFIRM, () => {
        this.setMode(Mode.MESSAGE);
        this.endPhase();
      }, () => this.isCurrentPhase(TurnInitPhase));
      this.onNextPrompt("CheckSwitchPhase", Mode.CONFIRM, () => {
        this.setMode(Mode.MESSAGE);
        this.endPhase();
      }, () => this.isCurrentPhase(TurnInitPhase));
      await this.phaseInterceptor.to(CommandPhase).catch((e) => reject(e));

      return resolve();
    });
  }

  /**
   * Checks if the player has won the battle.
   * @returns True if the player has won, otherwise false.
   */
  isVictory() {
    return this.scene.currentBattle.enemyParty.every(pokemon => pokemon.isFainted());
  }

  /**
   * Checks if the current phase matches the target phase.
   * @param phaseTarget - The target phase.
   * @returns True if the current phase matches the target phase, otherwise false.
   */
  isCurrentPhase(phaseTarget) {
    const targetName = typeof phaseTarget === "string" ? phaseTarget : phaseTarget.name;
    return this.scene.getCurrentPhase().constructor.name === targetName;
  }

  /**
   * Checks if the current mode matches the target mode.
   * @param mode - The target mode.
   * @returns True if the current mode matches the target mode, otherwise false.
   */
  isCurrentMode(mode: Mode) {
    return this.scene.ui?.getMode() === mode;
  }

  /**
   * Exports the save data to import it in a test game.
   * @returns A promise that resolves with the exported save data.
   */
  exportSaveToTest(): Promise<string> {
    return new Promise(async (resolve) => {
      await this.scene.gameData.saveAll(this.scene, true, true, true, true);
      this.scene.reset(true);
      await waitUntil(() => this.scene.ui?.getMode() === Mode.TITLE);
      await this.scene.gameData.tryExportData(GameDataType.SESSION, 0);
      await waitUntil(() => localStorage.hasOwnProperty("toExport"));
      return resolve(localStorage.getItem("toExport"));
    });
  }

  /**
   * Imports game data from a file.
   * @param path - The path to the data file.
   * @returns A promise that resolves with a tuple containing a boolean indicating success and an integer status code.
   */
  async importData(path): Promise<[boolean, integer]> {
    const saveKey = "x0i2O7WRiANTqPmZ";
    const dataRaw = fs.readFileSync(path, {encoding: "utf8", flag: "r"});
    let dataStr = AES.decrypt(dataRaw, saveKey).toString(enc.Utf8);
    dataStr = this.scene.gameData.convertSystemDataStr(dataStr);
    const systemData = this.scene.gameData.parseSystemData(dataStr);
    const valid = !!systemData.dexData && !!systemData.timestamp;
    if (valid) {
      await updateUserInfo();
      await this.scene.gameData.initSystem(dataStr);
    }
    return updateUserInfo();
  }

  async killPokemon(pokemon: PlayerPokemon | EnemyPokemon) {
    (this.scene.time as MockClock).overrideDelay = 0.01;
    return new Promise<void>(async(resolve, reject) => {
      pokemon.hp = 0;
      this.scene.pushPhase(new FaintPhase(this.scene, pokemon.getBattlerIndex(), true));
      await this.phaseInterceptor.to(FaintPhase).catch((e) => reject(e));
      (this.scene.time as MockClock).overrideDelay = undefined;
      resolve();
    });
  }
}
