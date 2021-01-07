// ======================================================================
//
//   GNU GENERAL PUBLIC LICENSE
//   Version 3, 29 June 2007
//   copyright (c) 2020 Quentin Gruber
//
//   https://github.com/QuentinGruber/h1z1-server
//   https://www.npmjs.com/package/h1z1-server
//
//   Based on https://github.com/psemu/soe-network
// ======================================================================

import { EventEmitter } from "events";
import { GatewayServer } from "../GatewayServer/gatewayserver";
import fs from "fs";
import { default as packetHandlers } from "./zonepackethandlers";
import { H1Z1Protocol as ZoneProtocol } from "../../protocols/h1z1protocol";
const spawnList = require("../../../data/spawnLocations.json");
import _ from "lodash";
import { Int64String, generateGuid } from "../../utils/utils"
const debug = require("debug")("ZoneServer");

Date.now = () => {
  // force current time
  return 971172000000;
};

interface Client {
  client: {
    characterId: string;
    state: {
      position: number[];
      rotation: number[];
      health: number;
      shield: number;
    };
    client: Client;
  };
  transientId: number;
  transientIds: {};
  character: {
    characterId: string;
    name?: string;
    loadouts?: any;
    currentLoadoutTab?: number;
    currentLoadoutId?: number;
    currentLoadout?: number;
    guid?: string;
    inventory?: Array<any>;
    factionId?: number;
    spawnLocation?: string;
    state: {
      position: number[];
      rotation: number[];
      health: number;
      shield: number;
    };
    client: Client;
  };
  sessionId: number;
  address: string;
  port: number;
  crcSeed: number;
  crcLength: number;
  clientUdpLength: number;
  serverUdpLength: number;
  sequences: any;
  compression: number;
  useEncryption: boolean;
  outQueue: any;
  outOfOrderPackets: any;
  nextAck: number;
  lastAck: number;
  inputStream: () => void;
  outputStream: () => void;
  outQueueTimer: () => void;
  ackTimer: () => void;
  outOfOrderTimer: () => void;
}

export class ZoneServer extends EventEmitter {
  _gatewayServer: any;
  _protocol: any;
  _clients: any;
  _characters: any;
  _ncps: any;
  _serverTime: any;
  _transientId: any;
  _guids: Array<string>;
  _packetHandlers: any;
  _referenceData: any;
  _startTime: number;
  _db: any;
  npcs: any;
  constructor(serverPort: number, gatewayKey: string) {
    super();
    this._gatewayServer = new GatewayServer(
      "ExternalGatewayApi_3",
      serverPort,
      gatewayKey
    );
    this._protocol = new ZoneProtocol();
    this._clients = {};
    this._characters = {};
    this._ncps = {};
    this._serverTime = Date.now() / 1000;
    this._transientId = 0;
    this._guids = [];
    this._referenceData = this.parseReferenceData()
    this._packetHandlers = packetHandlers;
    this._startTime = 0;

    this.on("data", (err, client, packet) => {
      if (err) {
        console.error(err);
      } else {
        if (packet.name != "KeepAlive") {
          debug(`Receive Data ${[packet.name]}`);
        }
        if (this._packetHandlers[packet.name]) {
          try {
            this._packetHandlers[packet.name](this, client, packet);
          } catch (e) {
            debug(e);
          }
        } else {
          debug(packet);
          debug("Packet not implemented in packetHandlers");
        }
      }
    });

    this.on("login", (err, client) => {
      if (err) {
        console.error(err);
      } else {
        debug("zone login");
        this.sendInitData(client);
      }
    });

    this._gatewayServer.on(
      "login",
      (err: string, client: Client, characterId: string) => {
        debug(
          "Client logged in from " +
            client.address +
            ":" +
            client.port +
            " with character id " +
            characterId
        );

        this._clients[client.sessionId] = client;
        client.transientIds = {};
        client.transientId = 0;
        client.character = {
          characterId: characterId,
          state: {
            position: [0, 0, 0, 0],
            rotation: [0, 0, 0, 0],
            health: 0,
            shield: 0,
          },
          client: client,
        };
        this._characters[characterId] = client.character;

        this.emit("login", err, client);
      }
    );

    this._gatewayServer.on("disconnect", (err: string, client: Client) => {
      debug("Client disconnected from " + client.address + ":" + client.port);
      delete this._clients[client.sessionId];
      this.emit("disconnect", err, client);
    });

    this._gatewayServer.on("session", (err: string, client: Client) => {
      debug("Session started for client " + client.address + ":" + client.port);
    });

    this._gatewayServer.on(
      "tunneldata",
      (err: string, client: Client, data: Buffer, flags: number) => {
        var packet = this._protocol.parse(
          data,
          flags,
          true,
          this._referenceData
        );
        if (packet) {
          this.emit("data", null, client, packet);
        } else {
          debug("zonefailed : ", data);
        }
      }
    );
  }
  async start() {
    debug("Starting server");
    this._startTime += Date.now();
    this._gatewayServer.start();
  }

  parseReferenceData() {
    var itemData = fs.readFileSync(
      `${__dirname}/../../../data/ClientItemDefinitions.txt`,
      "utf8"
    ),
    itemLines = itemData.split("\n"),
    items = {};
  for (var i = 1; i < itemLines.length; i++) {
    var line = itemLines[i].split("^");
    if (line[0]) {
      (items as any)[line[0]] = line[1];
    }
  }
    const referenceData = { itemTypes: items };
    return referenceData;
  }

  characterData(client: Client) {
    const self = require("../../../data/sendself.json"); // dummy self
    const {
      data: { identity },
    } = self;
    client.character.guid = self.data.guid;
    client.character.loadouts = self.data.characterLoadoutData.loadouts;
    client.character.inventory = self.data.inventory;
    client.character.factionId = self.data.factionId;
    client.character.name =
      identity.characterFirstName + identity.characterLastName;

    if (
      _.isEqual(self.data.position, [0, 0, 0, 1]) &&
      _.isEqual(self.data.rotation, [0, 0, 0, 1])
    ) {
      // if position/rotation hasn't be changed
      self.data.isRandomlySpawning = true;
    }

    if (self.data.isRandomlySpawning) {
      // Take position/rotation from a random spawn location.
      const randomSpawnIndex = Math.floor(Math.random() * spawnList.length);
      self.data.position = spawnList[randomSpawnIndex].position;
      self.data.rotation = spawnList[randomSpawnIndex].rotation;
      client.character.spawnLocation = spawnList[randomSpawnIndex].name;
    }
    this.sendData(client, "SendSelfToClient", self);
  }

  sendInitData(client:Client) {
    this.sendData(client, "InitializationParameters", {
      environment: "LIVE",
      serverId: 1,
    });
   
    const dumb_array = [] // TODO: generate this from dataschema
    for (let index = 0; index < 50; index++) {
      dumb_array.push(
        {
          unknownDword1: 0,
          unknownDword2: 0,
          unknownDword3: 0,
          unknownDword4: 0,
          unknownDword5: 0,
          unknownDword6: 0,
          unknownDword7: 0
        })
    }
    this.sendData(client, "SendZoneDetails", {
      unknownByte:0,
      zoneName: "Z1",
      unknownBoolean1: true,
      zoneType: 4,
      unknownFloat1: 1,
      skyData: {
        name: "sky",
        unknownDword1: 0,
        unknownDword2: 0,
        unknownDword3: 0,
        unknownDword4: 0,
        fogDensity: 0, // fog intensity
        fogGradient: 0,
        fogFloor: 0,
        unknownDword7: 0,
        unknownDword8: 0,
        temp: 40, // 0 : snow map , 40+ : spring map
        skyColor: 0,
        cloudWeight0: 0,
        cloudWeight1: 0,
        cloudWeight2: 0,
        cloudWeight3: 0,
        sunAxisX: 0,
        sunAxisY: 90,
        sunAxisZ: 0,
        unknownDword18: 0,
        unknownDword19: 0,
        unknownDword20: 0,
        wind: 0,
        unknownDword22: 0,
        unknownDword23: 0,
        unknownDword24: 0,
        unknownArray: dumb_array,
      },
      zoneId1: 3905829720,
      zoneId2: 3905829720,
      nameId: 7699,
      unknownBoolean7: true,
    });

    this.sendData(client, "ClientUpdate.ZonePopulation", {
      populations: [0, 0],
    });

    this.sendData(client, "ClientUpdate.RespawnLocations", {
      unknownFlags: 0,
      locations: [
        {
          guid: generateGuid(this._guids),
          respawnType: 1,
          position: [0, 50, 0, 1],
          unknownDword1: 1,
          unknownDword2: 1,
          iconId1: 1,
          iconId2: 1,
          respawnTotalTime: 1,
          respawnTimeMs: 1,
          nameId: 1,
          distance: 1,
          unknownByte1: 1,
          unknownByte2: 1,
          unknownData1: {
            unknownByte1: 1,
            unknownByte2: 1,
            unknownByte3: 1,
            unknownByte4: 1,
            unknownByte5: 1,
          },
          unknownDword4: 1,
          unknownByte3: 1,
          unknownByte4: 1,
        },
      ],
      unknownDword1: 0,
      unknownDword2: 0,
      locations2: [
        {
          guid: generateGuid(this._guids),
          respawnType: 1,
          position: [0, 50, 0, 1],
          unknownDword1: 1,
          unknownDword2: 1,
          iconId1: 1,
          iconId2: 1,
          respawnTotalTime: 1,
          respawnTimeMs: 1,
          nameId: 1,
          distance: 1,
          unknownByte1: 1,
          unknownByte2: 1,
          unknownData1: {
            unknownByte1: 1,
            unknownByte2: 1,
            unknownByte3: 1,
            unknownByte4: 1,
            unknownByte5: 1,
          },
          unknownDword4: 1,
          unknownByte3: 1,
          unknownByte4: 1,
        },
      ],
    });

    this.sendData(client, "ClientGameSettings", {
      unknownDword1: 0,
      unknownDword2: 7,
      unknownBoolean1: true,
      timescale: 1,
      unknownDword3: 1,
      unknownDword4: 1,
      unknownDword5: 0,
      unknownFloat2: 12,
      unknownFloat3: 110,
    });

    this.characterData(client);

    this.sendData(client, "PlayerUpdate.SetBattleRank", {
      characterId: client.character.characterId,
      battleRank: 100,
    });
  }

  data(collectionName: string) {
    if (this._db) {
      return this._db.collection(collectionName);
    }
  }

  sendSystemMessage(message: string) {
    this.sendDataToAll("Chat.Chat", {
      unknown2: 0,
      channel: 2,
      characterId1: "0x0000000000000000",
      characterId2: "0x0000000000000000",
      unknown5_0: 0,
      unknown5_1: 0,
      unknown5_2: 0,
      characterName1: "",
      unknown5_3: "",
      unknown6_0: 0,
      unknown6_1: 0,
      unknown6_2: 0,
      characterName2: "",
      unknown6_3: "",
      message: message,
      position: [0, 0, 0, 1],
      unknownGuid: "0x0000000000000000",
      unknown13: 0,
      color1: 0,
      color2: 0,
      unknown15: 0,
      unknown16: false,
    });
  }

  sendChat(client: Client, message: string, channel: number) {
    const { character } = client;
    this.sendData(client, "Chat.Chat", {
      channel: channel,
      characterName1: character.name,
      message: message,
      color1: 1,
    });
  }

  sendChatText(client: Client, message: string, clearChat: boolean = false) {
    if (clearChat) {
      for (let index = 0; index < 6; index++) {
        this.sendData(client, "Chat.ChatText", {
          message: " ",
          unknownDword1: 0,
          color: [255, 255, 255, 0],
          unknownDword2: 13951728,
          unknownByte3: 0,
          unknownByte4: 1,
        });
      }
    }
    this.sendData(client, "Chat.ChatText", {
      message: message,
      unknownDword1: 0,
      color: [255, 255, 255, 0],
      unknownDword2: 13951728,
      unknownByte3: 0,
      unknownByte4: 1,
    });
  }

  setCharacterLoadout(client: Client, loadoutId: number, loadoutTab: any) {
    for (var i = 0; i < client.character.loadouts.length; i++) {
      var loadout = client.character.loadouts[i];
      if (loadout.loadoutId == loadoutId && loadout.loadoutTab == loadoutTab) {
        this.sendChatText(client, "Setting loadout " + loadoutId);
        debug(JSON.stringify(loadout, null, 2));
        client.character.currentLoadout = loadout.loadoutData;

        client.character.currentLoadoutId = loadoutId;
        client.character.currentLoadoutTab = loadoutTab;
        this.sendData(client, "Loadout.SetCurrentLoadout", {
          type: 2,
          unknown1: 0,
          loadoutId: loadoutId,
          tabId: loadoutTab,
          unknown2: 1,
        });
        break;
      }
    }
  }
  sendData(client: Client, packetName: string, obj: any) {
    if (packetName != "KeepAlive") {
      debug("send data", packetName);
    }
    var data = this._protocol.pack(packetName, obj, this._referenceData);
    if (Array.isArray(client)) {
      for (var i = 0; i < client.length; i++) {
        this._gatewayServer.sendTunnelData(client[i], data);
      }
    } else {
      this._gatewayServer.sendTunnelData(client, data);
    }
  }

  sendDataToAll(packetName: string, obj: any) {
    for (var a in this._clients) {
      this.sendData(this._clients[a], packetName, obj);
    }
  }

  sendWeaponPacket(client: Client, packetName: string, obj: any) {
    var weaponPacket = {
      gameTime: this.getServerTime(),
      packetName: packetName,
      packet: obj,
    };
    this.sendData(client, "Weapon.Weapon", {
      weaponPacket: weaponPacket,
    });
  }

  sendRawData(client: Client, data: Buffer) {
    this._gatewayServer.sendTunnelData(client, data);
  }

  stop() {
    debug("Shutting down");
  }

  getGameTime() {
    debug("get game time");
    return Math.floor(Date.now() / 1000);
  }

  getServerTime() {
    debug("get server time");
    var delta = Date.now() - this._startTime;
    delta = Math.floor(delta / 1000);
    return this._serverTime + delta;
  }

  sendGameTimeSync(client: Client) {
    debug("GameTimeSync");
    this.sendData(client, "GameTimeSync", {
      time: Int64String(this.getGameTime()),
      unknownFloat1: 12,
      unknownBoolean1: false,
    });
  }

  getTransientId(client: any, guid: string) {
    if (!client.transientIds[guid]) {
      client.transientId++;
      client.transientIds[guid] = client.transientId;
    }
    return client.transientIds[guid];
  }

  spawnNPC(
    npcId: number,
    position: Array<number>,
    rotation: Array<number>,
    callback: any
  ) {
    this.data("npcs").findOne({ id: npcId }, (err: string, npc: any) => {
      if (err) {
        debug(err);
        return;
      }
      if (npc) {
        var guid: any = generateGuid(this._guids);
        this.npcs[guid] = {
          guid: guid,
          position: position,
          rotation: rotation,
          npcDefinition: npc,
        };
        /*
      var npcData = {
        guid: guid,
        transientId: this._transientId,
        unknownString0: "",
        nameId: npc.name_id > 0 ? npc.name_id : 0,
        unknownDword2: 242919,
        unknownDword3: 310060,
        unknownByte1: 1,
        modelId: npc.model_id || 0,
        scale: [1, 1, 1, 1],
        unknownString1: "",
        unknownString2: "",
        unknownDword5: 0,
        unknownDword6: 0,
        position: position,
        unknownVector1: [0, -0.7071066498756409, 0, 0.70710688829422],
        rotation: [-1.570796012878418, 0, 0, 0],
        unknownDword7: 0,
        unknownFloat1: 0,
        unknownString3: "",
        unknownString4: "",
        unknownString5: "",
        vehicleId: 0,
        unknownDword9: 0,
        npcDefinitionId: npc.id || 0,
        unknownByte2: 0,
        profileId: npc.profile_id || 0,
        unknownBoolean1: true,
        unknownData1: {
          unknownByte1: 16,
          unknownByte2: 10,
          unknownByte3: 0,
        },
        unknownByte6: 0,
        unknownDword11: 0,
        unknownGuid1: "0x0000000000000000",
        unknownData2: {
          unknownGuid1: "0x0000000000000000",
        },
        unknownDword12: 0,
        unknownDword13: 0,
        unknownDword14: 0,
        unknownByte7: 0,
        unknownArray1: [],
      };
      */
        callback(null, this.npcs[guid]);
      } else {
        callback("NPC " + npcId + " not found");
      }
    });
  }

  spawnVehicle(vehicleId: number) {}

  createPositionUpdate(position: Array<number>, rotation: Array<number>) {
    var obj = {
      flags: 4095,
      unknown2_int32: this.getGameTime(),
      unknown3_int8: 0,
      unknown4: 1,
      position: position,
      unknown6_int32: 3217625048,
      unknown7_float: 0,
      unknown8_float: 0,
      unknown9_float: 0,
      unknown10_float: 0,
      unknown11_float: 0,
      unknown12_float: [0, 0, 0],
      unknown13_float: rotation,
      unknown14_float: 0,
      unknown15_float: 0,
    };
    return obj;
  }
}
