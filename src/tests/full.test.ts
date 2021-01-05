import { LoginServer } from "../servers/LoginServer/loginserver";
import { ZoneServer } from "../servers/ZoneServer/zoneserver";
import { LoginClient } from "../clients/loginclient";

const { Base64 } = require("js-base64");

const testSoloLoginServer = new LoginServer(1115, ""); // solo server

testSoloLoginServer.start()

const testSoloZoneServer = new ZoneServer(1117, Base64.toUint8Array("F70IaxuU8C/w7FPXY1ibXw=="));

testSoloZoneServer.start()

console.log("Solo Servers launched")

const testLoginClient = new LoginClient("127.0.0.1",1115,Base64.toUint8Array("F70IaxuU8C/w7FPXY1ibXw=="),7544);

testLoginClient.connect()
