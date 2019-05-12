// IDE fix
var console = console;
var setState = setState;
var createState = createState;
var getState = getState;
var on = on;
var getAstroDate = getAstroDate;
var setTimeout = setTimeout;
var getObject = getObject;
var deleteState = deleteState;
var schedule = schedule;
var require = require;
var $ = $;
var Promise = Promise;


const wifiradio = require('wifiradio');


enum DayTimeMoment {
    /* The strings are used (in combination with the room name) to find scenes from the Phillip's Hue app */
    Morning = "M",
    DayLight = "D",
    Evening = "E",
    Night = "N"
}

enum Room {
    Wohnzimmer = "WZ",
    Schlafzimmer = "SZ",
    Flur = "F",
    Kueche = "K",
    BadGross = "BZG",
    BadKlein = "BZK",
}



class Radio {


    constructor(
        private ip:string,
        private pin:string,
        private mode:number,
        private volume:number
    ){}

    private forceTurnOn = function () {
        return new Promise((resolve, reject) => {
            let radio = new wifiradio(this.ip, this.pin);
            radio.setPower(0).then(() => {
                radio.setPower(1).then(() => {
                    radio.setPower(0).then(() => {
                        radio.setPower(1).then(() => {
                            setTimeout(() => {
                                resolve();
                            }, 1000);
                        }).catch((reason) => {
                            resolve(reason);
                        });
                    });
                }).catch(function(reason) {
                    reject(reason);
                });
            }).catch(function(reason) {
                reject(reason);
            });
        });
    };

    public turnRadioOff() {
        let radio = new wifiradio(this.ip, this.pin);
        radio.setPower(0);
    }

    public turnRadioOn() {
        this.forceTurnOn().then(() => {
            let radio = new wifiradio(this.ip, this.pin);
            radio.setMode(this.mode).then(() => {
                radio.setVolume(this.volume).catch((reason)=> {
                    console.error(reason);
                });
            }).catch((reason) => {
                console.error(reason);
            });
        }).catch(function(reason) {
            console.error(reason);
        });;
    }
}


class TimeOfDay {
    private minutesSinceMidnight:number;

    constructor (
        hour:number,
        minute:number
    ){
        this.minutesSinceMidnight = hour * 60 + minute;
    }

    public static fromDate(date:Date):TimeOfDay {
        return new TimeOfDay(date.getHours(), date.getMinutes());
    }

    public addMinutes(minutes:number):TimeOfDay {
        this.minutesSinceMidnight += minutes;
        return this;
    }

    public isBefore(timeOfDay: TimeOfDay): boolean {
        return this.minutesSinceMidnight < timeOfDay.minutesSinceMidnight;
    }
}


class DayTimePeriod {
    constructor(
        public id:DayTimeMoment,
        public startsAt: TimeOfDay
    ){}
}

function getDayTimePeriods(): DayTimePeriod[] {

    const dawn: Date = getAstroDate("dawn");
    const goldenHourEnd: Date = getAstroDate("goldenHourEnd");
    const solarNoon: Date = getAstroDate("solarNoon");
    const sunsetStart: Date = getAstroDate("sunsetStart");
    const night: Date = getAstroDate("night");

    return [
        {
            "id" : DayTimeMoment.Morning,
            "startsAt": new TimeOfDay(5,0)
        },
        {
            "id" : DayTimeMoment.DayLight,
            "startsAt": TimeOfDay.fromDate(goldenHourEnd)
        },
        {
            "id" : DayTimeMoment.Evening,
            "startsAt": TimeOfDay.fromDate(sunsetStart).addMinutes(-20)
        },
        {
            "id" : DayTimeMoment.Night,
            "startsAt": new TimeOfDay(23,0)
        },
    ]
}

class RoomLock {
    constructor(
        public isManualOverwrite: boolean,
        public expirationDate: number
    ) {}


    private toJson():string {
        return JSON.stringify(this);
    }

    public static fromJson(json:string):RoomLock {
        let obj:any =  JSON.parse(json);
        return new RoomLock(obj.isManualOverwrite, obj.expirationDate);
    }

    public static  onMotionSensor(ressource: string, sensorName: string, timeoutMs:number, callback:()=>void) {
        // Returns true if the light can be switched on
        if (this.isRessourceLockedByManualOverwrite(ressource)) {
            this.writeLock(ressource, 0, false, sensorName);
            return;
        }
        if (! this.isRessourceLockedBySensor(ressource)) {
            callback();
        }
        let timeOutOnCaseMotionSensorNeverTransmittsNoMotionEvent = 5 * 60 *60 * 1000;
        this.writeLock(ressource, timeOutOnCaseMotionSensorNeverTransmittsNoMotionEvent , false, sensorName);

    }
    public static onNoMotionSensor(ressource: string, sensorName: string, timeoutMs:number, callback:()=>void):void {

        if (this.isRessourceLockedByManualOverwrite(ressource)) {
            this.writeLock(ressource, 0, false, sensorName);
            return;
        }

        // unlock the ressource
        this.writeLock(ressource, (timeoutMs - MotionSensor.minimumNoMotionDelay), false, sensorName);

        console.log("scheduling timout callback for " +timeoutMs );
        // wait for the timeout:
        setTimeout(() => {
            if ( ! this.isRessourceLocked(ressource)) {
                console.log("Noone else has a lock. Turning off lights.");
                callback();
            } else {
                console.log("Not turning off lights, brcause someone else has a lock");
            }
        }, (timeoutMs - MotionSensor.minimumNoMotionDelay));
    }
    public static setManualOverwrite(ressource: string, durationInMs: number):void {
        console.log("locking room " + ressource + " for manual overwrite");
        this.writeLock(ressource, durationInMs, true);
    }

    private static isRessourceLocked(ressource: string): boolean {
        let locks = this.getListOfLocks(ressource);
        for (let lock of locks) {
            if (lock.isActive()) {
                console.log("Room " + ressource + " is locked by someone!");
                return true;
            }
        }
        return false;
    }

    private static isRessourceLockedBySensor(ressource: string):boolean {
        let locks = this.getListOfLocks(ressource);

        for (let lock of locks) {
            if (lock.isActive() && !(lock.isManualOverwrite)) {
                console.log("Room " + ressource + " is locked by another sensor");
                return true;
            }
        }
        console.log("room " + ressource + " is not locked by another sensor");
        return false;
    }

    private static isRessourceLockedByManualOverwrite(ressource: string):boolean {
        let locks = this.getListOfLocks(ressource);
        for (let lock of locks) {
            if (lock.isActive() && lock.isManualOverwrite) {
                console.log("Room " + ressource + " is locked by manual overwrite");
                return true;
            }
        }
        console.log("room " + ressource + " is not locked by manual overwrite");
        return false;
    }

    private isActive():boolean {
        return this.expirationDate > Date.now();
    }


// Delete States
    public static deleteStates():void{
        $(RoomLock.getGenericObjectId("*", "*")).each(function (id) {
            console.log("Deleting state for: " + id);
            deleteState(id);
        });
    }

    private static  writeLock(ressource: string, duration:number, isManualOverwrite: boolean, sensorName?:string):void {
        let json  = new RoomLock(isManualOverwrite, Date.now() + duration).toJson();
        let objectId: string = this.getObjectId(ressource, isManualOverwrite, sensorName);
        createState(objectId, json, true);
    }

    private static getListOfLocks(ressource):RoomLock[] {
        let resultList = [];

        let ids:string[] = $("[id=" + "*" + this.getGenericObjectId(ressource, "*") + "]");

        for (let id of ids) {
            let json = getState(id).val;
            let lock = this.fromJson(json);
            resultList.push(lock);
        }

        return resultList;
    }

    private static getGenericObjectId(ressource: string, lockName) {
        return  "RessourceLock." + ressource + "." + lockName;
    }

    private static getObjectId(ressource: string, isManualOverwrite: boolean, sensorName?:string) {
        return this.getGenericObjectId(ressource, (isManualOverwrite ? "manual" : sensorName));
    }
}





function registerHueDimmerButtonEvents(context:ActionContext, dimmerName:string, dimmerObjectID:string, dimmerSwitchLayout:DimmerSwitchLayout):void {
    on({id: dimmerObjectID, change: "ne"}, function (obj) {

        const clickedButtonEventId: number = obj.state.val;

        let buttonActions: DimmerSwitchButtonEventActions = dimmerSwitchLayout.getButtonEventActionsForEventId(clickedButtonEventId);
        if (buttonActions == null) {
            return;
        }
        if (buttonActions.buttonActions.length == 0){
            return;
        }

        // 1004 becomes 1000
        const buttonId: number = Math.floor((clickedButtonEventId / 1000)) * 1000;

        const rootStatePath:string = "Sensors.HueDimmer";
        const statePathLastClickedButtonId: string = rootStatePath + "." + dimmerName + "." + "LastClickedButtonId";
        const statePathDoubleClickHistory: string = rootStatePath + "." + dimmerName + "." + clickedButtonEventId;


        createState(statePathDoubleClickHistory, "{\"History\" : []}", () => {
            createState(statePathLastClickedButtonId, buttonId, () =>  {

                const lastClickedButtonId: number = getState(statePathLastClickedButtonId).val;
                setState(statePathLastClickedButtonId, buttonId);

                const doubleClickHistory = JSON.parse(getState(statePathDoubleClickHistory).val);
                if (lastClickedButtonId !== buttonId) {
                    // Forget history if different button was pressed earlier
                    doubleClickHistory.History = [];
                }
                else if (doubleClickHistory.History.length >= 1) {
                    const timeTheLastButtonWasPress: number = doubleClickHistory.History[Math.max(doubleClickHistory.History.length - 1)];
                    const currentTime: number = Date.now();
                    if ((currentTime - timeTheLastButtonWasPress) > 3000)  {
                        // Not a double press if too much time in-between clicks
                        doubleClickHistory.History = [];
                    }
                }

                if (doubleClickHistory.History.length >= buttonActions.buttonActions.length) {
                    // Reset cycle on too many presses
                    doubleClickHistory.History = [];
                }

                doubleClickHistory.History.push(Date.now());
                setState(statePathDoubleClickHistory, JSON.stringify(doubleClickHistory));

                // Execute the button Action
                const clickCounter: number = doubleClickHistory.History.length - 1;
                const buttonAction = buttonActions.buttonActions[clickCounter];
                buttonAction.action(context);

                // Prevent Motionsensors from overwriting the just set scene.
                const motionSensorOverwrites = buttonAction.motionSensorOverwrites;
                if (motionSensorOverwrites) {
                    for (let i = 0; i < motionSensorOverwrites.length; i++) {
                        const room: string = motionSensorOverwrites[i].room;
                        const durationInMs: number = motionSensorOverwrites[i].durationInMs;
                        let lockedUntil = Date.now() + durationInMs;
                        console.log("Setting motionSensorOverwrites for room " + room + " duration: " + durationInMs);
                        RoomLock.setManualOverwrite(room, durationInMs);
                    }
                } else {
                    console.log("no motionSensorOverwrites found!");
                }
            });
        });
    });
}


function registerHueSensorMotionEvent(sensorId: string, lockname: string, roomname: string, noMationAfterDelayInMsec: number, motionActions: MotionSensorActionBook) {
    on({id: sensorId, change: "ne"}, function (obj) {
        const motionDetected = obj.state.val;

        console.log(lockname + " Event incoming,  motionDetected: " + motionDetected);

        let onMotionAction:()=>void = null
        const timeOfDayMotionAction = getMotionActionMatchingTimeOfDay(motionActions);
        if (timeOfDayMotionAction == null && motionDetected) {
            console.log(lockname + " No motionAction found for this time of day");
            return;
        } else {
            onMotionAction = timeOfDayMotionAction.action;
        }

        const onNoMotionAction:()=>void = motionActions.onNoMoreMotionAction;

        if (motionDetected) {
            RoomLock.onMotionSensor(roomname, lockname, noMationAfterDelayInMsec, () => {
                console.log("calling ON callback");
                onMotionAction();
            });
        } else {
            RoomLock.onNoMotionSensor(roomname, lockname, noMationAfterDelayInMsec, () => {
                console.log("calling OFF callback!");
                onNoMotionAction();
            });
        }
    });
}


function getMotionActionMatchingTimeOfDay(motionActions: MotionSensorActionBook): DayTimeMotionSensorAction {
    const dayTimePeriodId = getCurrentDayTimePeriodId();
    const onMotionActions: DayTimeMotionSensorAction[] = motionActions.onMotionActions;
    for (let i = 0; i < motionActions.onMotionActions.length; i++) {
        const motionAction: DayTimeMotionSensorAction = onMotionActions[i];
        if (dayTimePeriodId == motionAction.dayTimePeriod) {
            return motionAction;
        }
    }
    console.warn("No matching action!");
    return null;
}

function getCurrentDayTimePeriodId():DayTimeMoment {
    let date:Date = new Date(Date.now());
    let currentTime:TimeOfDay = TimeOfDay.fromDate(date);

    let dayTimePeriods = getDayTimePeriods();

    let lastP = dayTimePeriods[dayTimePeriods.length - 1];
    for (let i = 0; i < dayTimePeriods.length; i++) {
        const p = dayTimePeriods[i];
        if (currentTime.isBefore(p.startsAt)) {
            return lastP.id;
        }
        lastP = p;
    }
    return dayTimePeriods[dayTimePeriods.length - 1].id;

}
getCurrentDayTimePeriodId();

function registerHueSensorCoupleMotionEvents(room, noMotionDelay, sensors: MotionSensor[], motionActions: MotionSensorActionBook) {
    for (let i = 0; i < sensors.length; i++) {
        const sensor = sensors[i];
        registerHueSensorMotionEvent(sensor.presensEventObjectId, sensor.sensorName, room, noMotionDelay, motionActions);
    }
}




class MotionSensor {
    public static  minimumNoMotionDelay: number = 14 * 1000;

    constructor (
        public sensorName:string,
        public presensEventObjectId:string
    ) {}
}


class DayTimeMotionSensorAction {
    constructor(
        public dayTimePeriod:DayTimeMoment,
        public action: ()=> void
    ) {
    }
}
class MotionSensorActionBook {
    constructor(
        public onMotionActions: DayTimeMotionSensorAction[],
        public onNoMoreMotionAction: ()=>void
    ){}

}

class RoomLockOverwriteInfo {
    constructor(
        public room:string,
        public durationInMs:number
    ) {}

}
class ButtonAction {
    constructor(
        public motionSensorOverwrites:RoomLockOverwriteInfo[],
        public action:(context:ActionContext)=>void
    ){}
}

class DimmerSwitchLayout {
    constructor(
        public buttonLayout: DimmerSwitchButtonEventActions[]
    ){}

    public getButtonEventActionsForEventId(eventId:number):DimmerSwitchButtonEventActions {
        for (let x of this.buttonLayout.filter((v, i ,a) => {
            return v.getEventIdAsNumber() == eventId;
        })) {
            return x;
        }
        return null;
    }
}

class DimmerSwitchButtonEventActions {
    constructor(
        public eventId:HueDimmerButtonEvents,
        public buttonActions:ButtonAction[]
    ){}

    public getEventIdAsNumber():number {
        return HueDimmerButtonEvents[HueDimmerButtonEvents[this.eventId]];
    }

}
enum HueDimmerButtonEvents {
    ON_BUTTON_DOWN = 1000,
    ON_BUTTON_UP = 1002,
    ON_BUTTON_LONG = 1003,

    BRIGHTER_BUTTON_DOWN = 2000,
    BRIGHTER_BUTTON_UP = 2002,
    BRIGHTER_BUTTON_LONG = 2003,

    DARKER_BUTTON_DOWN = 3000,
    DARKER_BUTTON_UP = 3002,
    DARKER_BUTTON_LONG = 3003,

    OFF_BUTTON_DOWN = 4000,
    OFF_BUTTON_UP = 4002,
    OFF_BUTTON_LONG = 4003
}

class RoomConfig {



    constructor(
        public roomname: Room,
        public radios:Radio[],
        public noMotionDelay: number,
        public hueRoomBrightnessObjectId,
        public hueScenes: HueScene[],
        public motionScenes: MotionSceneConfig[],
        public motionSensors: MotionSensor[],
        public dimmerSwitches: DimmerSwitch[],
        public defaultRoomActionsProvider: RoomAction[],
        public roomActions: RoomAction[]
    ){
        if (noMotionDelay < MotionSensor.minimumNoMotionDelay) {
            console.error("The NoMotionDelay must be larger " +
                "than 14 sec, as this is the minimum delay the " +
                "Hue Motion sensor needs to detect the absense " +
                "of motion");
            this.noMotionDelay = MotionSensor.minimumNoMotionDelay;
        }
    }

    public runRoomActionOfType(actionType: RoomActionType, context: ActionContext):void {
        this.getRoomActionsOfType(actionType, (x) => {
            x.action(context);
        })
    }

    private getRoomActionsOfType(actionType: RoomActionType, callback:(roomAction: RoomAction)=>void): RoomAction {

        let findInArray = function(actionArray:RoomAction[], actionToSearch: RoomActionType):RoomAction {

            for (let action of actionArray) {
                if (action.actionName === actionToSearch) {
                    return action;
                }
            }
            return null;
        };

        let result = findInArray(this.roomActions, actionType);

        if (result == null) {
            result = findInArray(this.defaultRoomActionsProvider, actionType);
        }

        if (result !== null) {
            callback(result);
        } else {
            console.warn("No action " + actionType + " found in room " + this.roomname);
        }
        return result;
    }
}


class HouseConfig {
    constructor(
        public roomConfigs: RoomConfig[]
    ) {}

    public turnHouseOff(context: ActionContext) {
        for (let roomConfig of this.roomConfigs) {
            let contextClone = context.clone();
            contextClone.roomConfig = roomConfig;
            roomConfig.runRoomActionOfType(RoomActionType.roomOff, contextClone );
        }
        RoomLock.deleteStates()
    }
}

class ActionContext {
    constructor(
        public houseConfig: HouseConfig,
        public roomConfig: RoomConfig,
        public initiator: string,
        public brightness?: number,
        public sceneIndex?:number,
        public dayTime?:DayTimeMoment
    ){}

    public clone():ActionContext {
        return new ActionContext(
            this.houseConfig,
            this.roomConfig,
            this.initiator,
            this.brightness,
            this.sceneIndex,
            this.dayTime
        );
    }

}

class DimmerSwitch {
    constructor(
        public  switchName:string,
        public buttonEventObjectId:string,
        public getButtonLayout:(context:ActionContext)=>DimmerSwitchLayout
    ){}
}



class RoomAction {
    constructor(
        public actionName: RoomActionType,
        public action:(context:ActionContext)=>void
    ){}
}

enum RoomActionType {
    activateScene = "activateScene",
    regulateBrightnes = "regulateBrightnes",
    onMotion = "onMotion",
    onNoMotion = "onNoMotion",
    musicOn = "music on",
    musicOff = "music off",
    musicNext = "musicNext",
    musicPrevious = "musicPrevious",
    musicVolumeUp = "musicVolumeUp",
    musicVolumeDown = "musicVolumeDown",
    ventilationOn = "ventilationOn",
    ventilationOff = "ventilationOff",
    tvOn = "tvOn",
    tvOff = "tvOff",
    tvVolumeUp = "tvVolumeUp",
    tvVolumeDown = "tvVolumeDown",
    turnLightsOff = "tvVolumeDown",
    roomOff = "roomOff"
}

function getDefaultRoomActions():RoomAction[] {
    return [
        {
            actionName: RoomActionType.roomOff,
            action: context => {
                for (let x of [
                    RoomActionType.musicOff,
                    RoomActionType.ventilationOff,
                    RoomActionType.tvOff,
                    RoomActionType.turnLightsOff
                ]) {
                    context.roomConfig.runRoomActionOfType(x, context);
                }
            }
        },
        {
            actionName: RoomActionType.regulateBrightnes,
            action: context => {
                setState(context.roomConfig.hueRoomBrightnessObjectId, context.brightness);
            }
        },
        {
            actionName: RoomActionType.activateScene,
            action: context => {
                let scenes = context.roomConfig.hueScenes;

                if ((scenes.length  == 0))  {
                    console.warn("No scenes defined for room " + context.roomConfig.roomname);
                    return;
                }
                let wantedSceneIndex = context.sceneIndex % scenes.length; //TODO off by one?
                let contextClone = context.clone();
                contextClone.sceneIndex = wantedSceneIndex;
                scenes[wantedSceneIndex].activateScene(contextClone);
            }
        },
        {
            actionName: RoomActionType.turnLightsOff,
            action: context => {
                let contextClone = context.clone();
                contextClone.brightness = 0;

                contextClone.roomConfig.runRoomActionOfType(RoomActionType.regulateBrightnes, contextClone);

            }
        },
        {
            actionName: RoomActionType.onNoMotion,
            action: context => {
                context.roomConfig.runRoomActionOfType(RoomActionType.turnLightsOff, context);
                context.roomConfig.runRoomActionOfType(RoomActionType.musicOff, context);
            }
        },
        {
            actionName: RoomActionType.musicOn,
            action: context => {
                for (let radio of context.roomConfig.radios) {
                    radio.turnRadioOn();
                }
            }
        },
        {
            actionName: RoomActionType.musicOff,
            action: context => {
                for (let radio of context.roomConfig.radios) {
                    radio.turnRadioOff();
                }
            }
        },
        {
            actionName: RoomActionType.onMotion,
            action: context => {
                let motionScene = context.roomConfig.motionScenes[context.sceneIndex];
                motionScene.hueScene.activateScene(context);
                if (motionScene.activateRadio) {
                    context.roomConfig.runRoomActionOfType(RoomActionType.musicOn, context);
                }
            }
        }
    ];
}


class HueScene{
    constructor(
        protected action:(contex:ActionContext)=>void
    ){}

    public activateScene(contex:ActionContext):void {
        this.action(contex);
    }
}

abstract class AutoWiredHueScene extends HueScene{
    constructor(
        protected action:(contex:ActionContext)=>void
    ) {
        super(action);
    }

    protected getHueSceneObjectIds(room: Room, sceneName: string):string {
        const sceneNamespace = "javascript.0.PhilipsHue.Scenes";

        let roomName:string = room;
        let searchname = sceneNamespace + "." + roomName + "." + sceneName + "*";
        let ids = $("[id=" + searchname + ".*]");

        if (ids.length == 0) {
            console.warn("Scene not found: " + searchname);
            return null;
        }
        console.log("Scenes found for " + searchname + ": " + ids.length);
        // random element of found ids.
        return ids[Math.floor(Math.random()*ids.length)];
    }
}

class AutowiredButtonHueScene extends AutoWiredHueScene{
    constructor(){
        super((context: ActionContext) => {
            let id = this.getHueSceneObjectIdsSceneIndex(context.roomConfig.roomname, context.sceneIndex);
            if (id !== null) {
                if( id.toLowerCase().indexOf('off') < 0){
                    setState(id, true);
                }
            }
            if( id.toLowerCase().indexOf('radio') >= 0){
                context.roomConfig.runRoomActionOfType(RoomActionType.musicOn, context);
            }
        });
    }

    private getHueSceneObjectIdsSceneIndex(room: Room, sceneIndex:number):string {
        let sceneName:string =  "" + (sceneIndex + 1);
        return this.getHueSceneObjectIds(room, sceneName);
    }
}



class AutowiredMotionScene extends AutoWiredHueScene{
    constructor(
    ){
        super((context: ActionContext) => {
            let id = this.getHueSceneObjectIdsDayTime(context.roomConfig.roomname, context.dayTime);
            if (id !== null) {
                if( id.toLowerCase().indexOf('off') < 0){
                    setState(id, true);
                }
            }
            if( id.toLowerCase().indexOf('radio') >= 0){
                context.roomConfig.runRoomActionOfType(RoomActionType.musicOn, context);
            }
        });
    }
    private getHueSceneObjectIdsDayTime(room: Room, dayTimeMoment:DayTimeMoment):string {
        let sceneName:string =  dayTimeMoment;
        return this.getHueSceneObjectIds(room, sceneName);
    }
}




function registerHouseConfig(houseConfig: HouseConfig) {
    for (let roomConfig of houseConfig.roomConfigs) {
        for (let dimmerSwitch of roomConfig.dimmerSwitches) {
            let context = new ActionContext(houseConfig, roomConfig, dimmerSwitch.switchName);
            let dimmerSwitchLayout = dimmerSwitch.getButtonLayout(context);

            registerHueDimmerButtonEvents(context, dimmerSwitch.switchName, dimmerSwitch.buttonEventObjectId, dimmerSwitchLayout);

        }

        if (roomConfig.motionSensors.length > 0) {
            let context = new ActionContext(houseConfig, roomConfig, roomConfig.motionSensors[0].sensorName);
            registerHueSensorCoupleMotionEvents(
                roomConfig.roomname,
                roomConfig.noMotionDelay,
                roomConfig.motionSensors,
                new MotionSensorActionBook(
                    (()=> {
                        let sensorActions = [];

                        for (let i = 0; i < roomConfig.motionScenes.length; i++) {
                            let motionScene = roomConfig.motionScenes[i];

                            sensorActions.push(new DayTimeMotionSensorAction(
                                motionScene.dayTime,
                                () => {
                                    let contextClone = context.clone();
                                    contextClone.dayTime = motionScene.dayTime;
                                    contextClone.sceneIndex = i;
                                    roomConfig.runRoomActionOfType(RoomActionType.onMotion, contextClone);
                                }
                            ))
                        }
                        return sensorActions
                    })(),
                    () => {
                        roomConfig.runRoomActionOfType(RoomActionType.onNoMotion, context)
                    }
                )
            );
        }
    }
}

class MotionSceneConfig {
    constructor(
        public dayTime: DayTimeMoment,
        public activateRadio: boolean,
        public hueScene: HueScene
    ) {}
}

function getDefaultMotionSceneConfigs() {
    return [
        new MotionSceneConfig(
            DayTimeMoment.Morning,
            false,
            new AutowiredMotionScene()
        ),
        new MotionSceneConfig(
            DayTimeMoment.DayLight,
            false,
            new AutowiredMotionScene()
        ),
        new MotionSceneConfig(
            DayTimeMoment.Evening,
            false,
            new AutowiredMotionScene()
        ),
        new MotionSceneConfig(
            DayTimeMoment.Night,
            false,
            new AutowiredMotionScene()
        )
    ];
}

function getDefaultHueScenes() {
    return [
        new AutowiredButtonHueScene(),
        new AutowiredButtonHueScene(),
        new AutowiredButtonHueScene(),
        new AutowiredButtonHueScene(),
        new AutowiredButtonHueScene()
    ];
}


class DefaultRoomConfig extends RoomConfig{

    constructor(
        roomname: Room,
        radios:Radio[],
        roomNameInHueApp,
        noMotionDelay: number,
        motionSensors: string[],
        dimmerSwitches: DimmerSwitch[],
        roomActions: RoomAction[]
    ) {
        super(
            roomname,
            radios,
            noMotionDelay,
            "hue.1.Hue_02." + roomNameInHueApp + ".bri",
            getDefaultHueScenes(),
            getDefaultMotionSceneConfigs(),
            DefaultHueMotionScensor.fromList(motionSensors),
            dimmerSwitches,
            (()=>{ return getDefaultRoomActions()})(),
            roomActions
        );
    }
}

class DefaultDimmerSwitch extends DimmerSwitch{

    constructor(
        switchName: string,
        getButtonLayout: (context: ActionContext) => DimmerSwitchLayout = (context => DefaultDimmerSwitch.getLayout01(context, false, false,false))) {
        super(
            switchName,
            DeviceDiscovery.getObjectIdByName(switchName),
            getButtonLayout);
    }

    public static fromList(list:string[]):DefaultDimmerSwitch[] {
        let result = [];
        for (let x of list) {
            result.push( new DefaultDimmerSwitch(x));
        }
        return result;
    }

    public static getLayout01(context:ActionContext, offButtonTurnsEntireRoomOff:boolean,  offButtonTurnsEntireHouseOff:boolean, longOffButtonTurnsHouseOff: boolean):DimmerSwitchLayout {
        let motionSensorOverwrite = (duration:number ) => {
            return  [
                new RoomLockOverwriteInfo(context.roomConfig.roomname, duration)
            ];
        };
        let defaultOverwrite: number = 2 * 60 * 60 * 1000;

        let setBrightness = (brightness: number) => {
            return new ButtonAction(
                motionSensorOverwrite(defaultOverwrite),
                (context) => {
                    console.log("Setting brightness to " + brightness);
                    let contextClone = context.clone();
                    contextClone.brightness = brightness;
                    contextClone.roomConfig.runRoomActionOfType(RoomActionType.regulateBrightnes, contextClone);
                }
            )
        };


        return new DimmerSwitchLayout([
            new DimmerSwitchButtonEventActions(HueDimmerButtonEvents.ON_BUTTON_UP,(()=>{
                let x = [];
                for (let i = 0; i < context.roomConfig.hueScenes.length; i++) {
                    x.push(
                        new ButtonAction(
                            motionSensorOverwrite(defaultOverwrite),
                            (context) => {
                                console.log("Turning lights on");
                                let contextClone = context.clone();
                                contextClone.sceneIndex = i;
                                contextClone.roomConfig.runRoomActionOfType(RoomActionType.activateScene, contextClone);
                            }
                        )
                    );
                }
                return x;
            })()),
            new DimmerSwitchButtonEventActions(HueDimmerButtonEvents.ON_BUTTON_LONG, [
                new ButtonAction(
                    [],
                    (context) => {
                        setState("javascript.0.PhilipsHue.Scenes.Resync", true);
                    }
                )
            ]),
            new DimmerSwitchButtonEventActions(HueDimmerButtonEvents.DARKER_BUTTON_DOWN, [
                setBrightness(125),
                setBrightness(100),
                setBrightness(75),
                setBrightness(50),
                setBrightness(25),
                setBrightness(20),
                setBrightness(15),
                setBrightness(10),
                setBrightness(5),
                setBrightness(5),
                setBrightness(5),
                setBrightness(5),

            ]),
            new DimmerSwitchButtonEventActions(HueDimmerButtonEvents.BRIGHTER_BUTTON_UP, [
                setBrightness(150),
                setBrightness(175),
                setBrightness(200),
                setBrightness(225),
                setBrightness(254),
                setBrightness(254),
                setBrightness(254),
            ]),
            new DimmerSwitchButtonEventActions(HueDimmerButtonEvents.DARKER_BUTTON_LONG, [
                new ButtonAction(
                    [],
                    (contect) => {
                        contect.roomConfig.runRoomActionOfType(RoomActionType.ventilationOn, contect);
                    }
                ),
                new ButtonAction(
                    [],
                    (context) => {
                        context.roomConfig.runRoomActionOfType(RoomActionType.ventilationOff, context);
                    }
                )
            ]),
            new DimmerSwitchButtonEventActions(HueDimmerButtonEvents.OFF_BUTTON_UP, [
                new ButtonAction(
                    motionSensorOverwrite(3000),
                    (context) => {
                        if (offButtonTurnsEntireRoomOff) {
                            context.roomConfig.runRoomActionOfType(RoomActionType.roomOff, context);
                        } else if (offButtonTurnsEntireHouseOff) {
                            context.houseConfig.turnHouseOff(context);
                        }
                        else {
                            context.roomConfig.runRoomActionOfType(RoomActionType.turnLightsOff, context);
                        }
                    }
                ),
                new ButtonAction(
                    motionSensorOverwrite(2 * 60 * 60 * 1000),
                    (context) => {
                        console.log("Turning lights off");
                        context.roomConfig.runRoomActionOfType(RoomActionType.turnLightsOff, context);
                    }
                )
            ]),
            new DimmerSwitchButtonEventActions(HueDimmerButtonEvents.OFF_BUTTON_LONG, [
                new ButtonAction(
                    motionSensorOverwrite(3000),
                    (context) => {
                        if (longOffButtonTurnsHouseOff) {
                            context.houseConfig.turnHouseOff(context);
                        } else {
                            context.roomConfig.runRoomActionOfType(RoomActionType.roomOff, context);
                        }

                    }
                ),
                new ButtonAction(
                    motionSensorOverwrite(3000),
                    (context) => {
                        context.houseConfig.turnHouseOff(context);
                    }
                )
            ]),
        ]);
    }
}

class DefaultHueMotionScensor extends MotionSensor{

    constructor(
        sensorName: string
    ) {
        super(
            sensorName,
            DeviceDiscovery.getObjectIdByName(sensorName));
    }

    public static fromList(list:string[]) {
        let result = [];
        for (let x of list) {
            result.push(new DefaultHueMotionScensor(x))
        }
        return result;
    }
}



class DeviceDiscovery {

    private static devices = {};
    static initialize() {
        DeviceDiscovery.discoverDevices(
            DeviceDiscovery.devices,
            "deconz.0.Sensors.*.presence",
            ".M"
        );

        DeviceDiscovery.discoverDevices(
            DeviceDiscovery.devices,
            "deconz.0.Sensors.*.buttonevent",
            ""
        );

        console.log("Discovered devices: " + JSON.stringify(this.devices));
    }

    private static  discoverDevices (returnObject: any ,searchString: string, suffix:string) {
        let t = "[id=" + searchString + "]";
        let discoveredIds:any = $(t);
        for (let id of discoveredIds) {
            if (! (id)) {
                continue;
            }
            let obj = getObject(id);
            if (! (obj)) {
                continue;
            }

            let commonName:string = obj.common.name;
            if (! (commonName)) {
                continue;
            }
            var s = commonName.split(" ", 2);
            if (s.length < 1) {
                continue;
            }
            returnObject["" + s[0] + suffix] = id;
        }
        return returnObject;
    }

    public static getObjectIdByName(name:string):string {
        let result = DeviceDiscovery.devices[name];
        if (result) {
            return result;
        }
        /*
        switch (name) {
            case "A8": {
                return "deconz.0.Sensors.20.buttonevent";
            }
            case "A3": {
                return "deconz.0.Sensors.19.buttonevent";
            }
            case "A4": {
                return "deconz.0.Sensors.18.buttonevent";
            }
            case "C2": {
                return "deconz.0.Sensors.17.buttonevent";
            }
            case "C9": {
                return "deconz.0.Sensors.16.buttonevent";
            }
            case "C7": {
                return "deconz.0.Sensors.15.buttonevent";
            }
            case "A9": {
                return "deconz.0.Sensors.14.buttonevent";
            }
            case "C6": {
                return "deconz.0.Sensors.13.buttonevent";
            }
            case "A2": {
                return "deconz.0.Sensors.12.buttonevent";
            }
            case "A5": {
                return "deconz.0.Sensors.11.buttonevent";
            }
            case "A6": {
                return "deconz.0.Sensors.10.buttonevent";
            }
            case "A1": {
                return "deconz.0.Sensors.9.buttonevent";
            }
            case "C1": {
                return "deconz.0.Sensors.8.buttonevent";
            }
            case "B1": {
                return "deconz.0.Sensors.7.buttonevent";
            }
            case "A7": {
                return "deconz.0.Sensors.6.buttonevent";
            }
            case "B4.M": {
                return 'deconz.0.Sensors.3.presence';
            }
            case "No-Name": {
                return "deconz.0.Sensors.2.buttonevent";
            }
        }
        */
        return null;
    }
}
DeviceDiscovery.initialize();


(function main():void {
    registerHouseConfig(
        new HouseConfig(
            [
                new DefaultRoomConfig(
                    Room.Wohnzimmer,
                    [],
                    'Wohnzimmer',
                    2 * 60 * 1000,
                    [
                        "B4.M"
                    ],
                    DefaultDimmerSwitch.fromList(
                        [
                            "A8",
                            "A2",
                            "B1",
                            "C8"
                        ]
                    ),
                    []
                ),
                new DefaultRoomConfig(
                    Room.Schlafzimmer,
                    [],
                    'Schlafzimmer',
                    3 * 60 * 1000,
                    [
                      //  "B6.M"
                    ],
                    DefaultDimmerSwitch.fromList(
                        [
                            "A7",
                            "A1",
                            "C7"
                        ]
                    ),
                    []
                ),
                new DefaultRoomConfig(
                    Room.Flur,
                    [],
                    'Flur',
                    2 * 60 * 1000,
                    [
                        "B8.M",
                        "B7.M"
                    ],
                    (()=>{
                        let array = DefaultDimmerSwitch.fromList(
                            [
                                "C6",
                                "A4",
                                "A6"
                            ]
                        );
                        array.push(new DefaultDimmerSwitch(
                                "C9",
                                (context => DefaultDimmerSwitch.getLayout01(context, false, true,false))
                            )
                        );
                        return array;
                    })(),
                    []
                ),
                new DefaultRoomConfig(
                    Room.Kueche,
                        [
                            new Radio("10.0.0.10", "1234", 3, 15)
                        ],
                    'Kueche',
                    5 * 60 * 1000,
                    [
                       "B9.M",
                       "B5.M"
                    ],
                    (()=>{
                        let array = DefaultDimmerSwitch.fromList(
                            []
                        );
                        array.push(new DefaultDimmerSwitch(
                            "A3",
                            (context => DefaultDimmerSwitch.getLayout01(context, true, false,false))
                            )
                        );

                        return array;
                    })(),
                    []
                ),
                new DefaultRoomConfig(
                    Room.BadGross,
                    [
                        new Radio("10.0.0.13", "1234", 3, 15)
                    ],
                    'BadezimmerGross',
                    7 * 60 * 1000,
                    [
                        "B2.M"
                    ],
                    (()=>{
                        let array = DefaultDimmerSwitch.fromList(
                            []
                        );
                        array.push(new DefaultDimmerSwitch(
                            "A9",
                            (context => DefaultDimmerSwitch.getLayout01(context, true, false,false))
                            )
                        );
                        array.push(new DefaultDimmerSwitch(
                            "A6",
                            (context => DefaultDimmerSwitch.getLayout01(context, true, false,false))
                            )
                        );
                        return array;
                    })(),
                    []
                ),
                new DefaultRoomConfig(
                    Room.BadKlein,
                    [
                        new Radio("10.0.0.40", "1234", 0, 15)
                    ],
                    'BadezimmerKlein',
                    4 * 60 * 1000,
                    [
                        "B3.M"
                    ],
                    (()=>{
                        let array = DefaultDimmerSwitch.fromList(
                            []
                        );
                        array.push(new DefaultDimmerSwitch(
                            "C2",
                            (context => DefaultDimmerSwitch.getLayout01(context, true, false,false))
                            )
                        );
                        return array;
                    })(),
                    []
                )
            ]
        )
    );
})();
