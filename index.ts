// IDE fix
var console = console;
var setState = setState;
var createState = createState;
var getState = getState;
var on = on;
var getAstroDate = getAstroDate;
var setTimeout = setTimeout;
var getObject = getObject;
var $ = $;
//--------------------------------------------

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
        public lockOwner: string,
        public isManualOverwrite: boolean,
        public expirationDate: number,
        public turnOffId: number) {
    }

    public static setRoomLock(roomName:string, lock:RoomLock) {
        lock.saveToState(roomName);
    }
    public static loadFromState(roomName:string):RoomLock {
        let obj:any =  JSON.parse(getState(RoomLock.getSatePathOfRoomLock(roomName)).val);
        return new RoomLock(obj.lockOwner, obj.isManualOverwrite, obj.expirationDate, obj.turnOffId);
    }

    private toJson():string {
        return JSON.stringify(this);
    }
    public saveToState(roomName: string){
        let json :string = JSON.stringify(this);
        setState(RoomLock.getSatePathOfRoomLock(roomName), json);
    }

    public static createRoomLockStateIfNotExist(roomName:string, callback: () => void):void {
        const x: RoomLock = new RoomLock("",false,0, 0);
        createState(RoomLock.getSatePathOfRoomLock(roomName), x.toJson(), callback);
    }

    public static getSatePathOfRoomLock(roomName:string):string {
        return  "Sensors.MotionSensors" + "." + roomName;
    }

    public static amITheRoomLockOwner(roomname:string, myLockName:string):boolean {
        const state = RoomLock.loadFromState(roomname);
        if (state.expirationDate < Date.now()) {
            return true;
        }
        return (state.lockOwner == myLockName);
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

                        RoomLock.createRoomLockStateIfNotExist(room, () => {
                            let lock = new RoomLock(dimmerName, true, lockedUntil , 0);
                            lock.saveToState(room);
                            console.log("Setting motionSensorOverwrites for room " + room + " duration: " + durationInMs);
                        })
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
        RoomLock.createRoomLockStateIfNotExist(roomname, () => {
            const motionDetected = obj.state.val;
            const oldValue = obj.oldState.val;

            console.log(lockname + " Event incoming,  motionDetected: " + motionDetected);

            const timeOfDayMotionAction = getMotionActionMatchingTimeOfDay(motionActions);
            if (timeOfDayMotionAction == null) {
                console.log(lockname + " No motionAction found for this time of day");
                return;
            }
            const onMotionAction:()=>void = timeOfDayMotionAction.action;
            const onNoMotionAction:()=>void = motionActions.onNoMoreMotionAction;

            if (RoomLock.amITheRoomLockOwner(roomname, lockname)) {
                console.log(lockname + " is the lock owner");
                if (motionDetected) {
                    console.log(lockname + " executing motion action");
                    RoomLock.setRoomLock(roomname, new RoomLock(lockname, false, 3*60*60*1000, 0));
                    onMotionAction();
                    return;
                } else {
                    if (RoomLock.loadFromState(roomname).isManualOverwrite) {
                        console.log(lockname + " Ignoring noMotion event because of old manual overwrite");
                        return;
                    }
                    const turnOffId = Date.now();
                    console.log(lockname + " No more motion! setting up delay...");
                    RoomLock.setRoomLock(roomname, new RoomLock(lockname, false, noMationAfterDelayInMsec, turnOffId));
                    setTimeout(()=> {
                        if (! RoomLock.amITheRoomLockOwner(roomname, lockname)) {
                            console.log(lockname + " Delayed:  not the lock owner");
                            return;
                        }
                        if (RoomLock.loadFromState(roomname).turnOffId !== turnOffId) {
                            console.log(lockname + " Delayed:  incorrect turnOffId");
                            return;
                        }
                        console.log(lockname + " Delayed:  executing noMotionAction");
                        RoomLock.setRoomLock(roomname, new RoomLock( lockname, false, 0, 0)); // Remove the lock
                        onNoMotionAction();
                    }, noMationAfterDelayInMsec);
                }
            } else {
                console.log(lockname + " is not the lock owner");
                if (RoomLock.loadFromState(roomname).isManualOverwrite) {
                    console.log(lockname + " Room is locked by manual overwrite");
                } else {
                    console.log(lockname + " is not locked by manual overwrite");
                    if (motionDetected) {
                        RoomLock.setRoomLock(roomname, new RoomLock( lockname, false, 3*60*60*1000, 0));
                        onMotionAction();
                        console.log(lockname + " Taking over existing lock");
                    }
                }
            }
        });
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
            console.log("Current DayTimeId= " + lastP.id);
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
        public noMotionDelay: number,
        public hueRoomBrightnessObjectId,
        public hueScenes: HueScene[],
        public motionScenes: MotionSceneConfig[],
        public motionSensors: MotionSensor[],
        public dimmerSwitches: DimmerSwitch[],
        public defaultRoomActionsProvider: RoomAction[],
        public roomActions: RoomAction[]
    ){}

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

        console.log("result: " + result);
        if (result !== null) {
            console.log("Action was found -- calling callback");
            callback(result);
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
            context.roomConfig.runRoomActionOfType(RoomActionType.roomOff, context);
        }
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
    activateScene,
    regulateBrightnes,
    onMotion,
    onNoMotion,
    musicOn,
    musicOff,
    musicNext,
    musicPrevious,
    musicVolumeUp,
    musicVolumeDown,
    ventilationOn,
    ventilationOff,
    tvOn,
    tvOff,
    tvVolumeUp,
    tvVolumeDown,
    turnLightsOff,
    roomOff
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
                    console.error("No scenes defined for room " + context.roomConfig.roomname);
                    return;
                }
                let wantedSceneIndex = context.sceneIndex % scenes.length; //TODO off by one?
                context.sceneIndex = wantedSceneIndex;
                console.log("activating scene index: " + wantedSceneIndex);
                scenes[wantedSceneIndex].activateScene(context);
            }
        },
        {
            actionName: RoomActionType.turnLightsOff,
            action: context => {
                context.brightness = 0;

                context.roomConfig.runRoomActionOfType(RoomActionType.regulateBrightnes, context);

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

    protected getHueSceneObjectIds(room: Room, sceneName: string, callBack:(id, index)=>any) {
        const sceneNamespace = "javascript.0.PhilipsHue.Scenes";

        let roomName:string = room;
        let searchname = sceneNamespace + "." + roomName + "." + sceneName;
        console.log("searching for name " + searchname );

        let cacheSelectorallefalse = $("[id=" + searchname + ".*]");
        cacheSelectorallefalse.each(callBack);
    }
}

class AutowiredButtonHueScene extends AutoWiredHueScene{
    constructor(){
        super((context: ActionContext) => {
            this.getHueSceneObjectIdsSceneIndex(context.roomConfig.roomname, context.sceneIndex, (id, index)=> {
                console.log("Activating scene:" + id);
                setState(id, true);
            });
        });
    }

    private getHueSceneObjectIdsSceneIndex(room: Room, sceneIndex:number, callBack:(id, index)=>any) {
        let sceneName:string =  "" + (sceneIndex + 1);
        this.getHueSceneObjectIds(room, sceneName, callBack);
    }
}



class AutowiredMotionScene extends AutoWiredHueScene{
    constructor(
    ){
        super((context: ActionContext) => {
            this.getHueSceneObjectIdsDayTime(context.roomConfig.roomname, context.dayTime, (id:number, index:number)=> {
                setState(id, true);
            });
        });
    }
    private getHueSceneObjectIdsDayTime(room: Room, dayTimeMoment:DayTimeMoment, callBack:(id, index)=>any) {
        let sceneName:string =  dayTimeMoment;
        this.getHueSceneObjectIds(room, sceneName, callBack);
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
                                    context.dayTime = motionScene.dayTime;
                                    context.sceneIndex = i;
                                    roomConfig.runRoomActionOfType(RoomActionType.onMotion, context);
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
        roomNameInHueApp,
        noMotionDelay: number,
        motionSensors: string[],
        dimmerSwitches: string[],
        roomActions: RoomAction[]
    ) {
        super(
            roomname,
            noMotionDelay,
            "hue.1.Hue_02." + roomNameInHueApp + ".bri",
            getDefaultHueScenes(),
            getDefaultMotionSceneConfigs(),
            DefaultHueMotionScensor.fromList(motionSensors),
            DefaultDimmerSwitch.fromList(dimmerSwitches),
            (()=>{ return getDefaultRoomActions()})(),
            roomActions
        );
    }
}

class DefaultDimmerSwitch extends DimmerSwitch{

    constructor(
        switchName: string,
        getButtonLayout: (context: ActionContext) => DimmerSwitchLayout = (context => DefaultDimmerSwitch.getLayout01(context, false, false))) {
        super(
            switchName,
            getObjectIdByName(switchName),
            getButtonLayout);
    }

    public static fromList(list:string[]):DefaultDimmerSwitch[] {
        let result = [];
        for (let x of list) {
            result.push( new DefaultDimmerSwitch(x));
        }
        return result;
    }

    public static getLayout01(context:ActionContext, offButtonTurnsEntireRoomOff:boolean,  longOffButtonTurnsHouseOff: boolean):DimmerSwitchLayout {
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
                    context.brightness = brightness;
                    context.roomConfig.runRoomActionOfType(RoomActionType.regulateBrightnes, context);
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
                                context.sceneIndex = i;
                                context.roomConfig.runRoomActionOfType(RoomActionType.activateScene, context);
                            }
                        )
                    );
                }
                return x;
            })()),
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
                        } else {
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
            getObjectIdByName(sensorName));
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
            "-M"
        );
    }

    private static  discoverDevices (returnObject: any ,searchString: string, suffix:string) {
        let t = "[id=" + searchString + "]";
        let discoveredIds:any = $(t);
        for (var id of discoveredIds) {
            if (! (id)) {
                continue;
            }
            var obj = getObject(id);
            if (! (obj)) {
                continue;
            }

            let commonName:string = obj.common.name;
            if (! (commonName)) {
                continue;
            }
            let s = commonName.split(" ", 2);
            if (s.length < 1) {
                continue;
            }
            returnObject[s[0] + suffix] = id;
        }
        return returnObject;
    }

    public static getObjectIdByName(name:string):string {
        let result = DeviceDiscovery.devices[name];
        if (result) {
            return result;
        }
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
                return 'deconz.0.Sensors.3.presence'/*B4 Bewegungsmelder presence*/;
            }
            case "No-Name": {
                return "deconz.0.Sensors.2.buttonevent";
            }
        }
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
                    'Wohnzimmer',
                    5000,
                    [
                        "B4.M"
                    ],
                    [
                        "A8",
                        "A2",
                        "B1"
                    ],
                    []
                ),
                new DefaultRoomConfig(
                    Room.Schlafzimmer,
                    'Schlafzimmer',
                    5000,
                    [
                        "B4.M"
                    ],
                    [
                        "A7",
                        "A1",
                        "C7"
                    ],
                    []
                ),
                new DefaultRoomConfig(
                    Room.Flur,
                    'Flur',
                    5000,
                    [
                        "B4.M"
                    ],
                    [
                        "C6",
                        "C9",
                        "A4",
                        "A6"
                    ],
                    []
                ),
                new DefaultRoomConfig(
                    Room.Kueche,
                    'Kueche',
                    10 * 60 * 60 * 1000,
                    [
                        "B4.M"
                    ],
                    [
                        "C2"

                    ],
                    []
                ),
                new DefaultRoomConfig(
                    Room.BadGross,
                    'BadezimmerGross',
                    5000,
                    [
                        "B4.M"
                    ],
                    [
                        "A9",
                        "C1"
                    ],
                    []
                ),
                new DefaultRoomConfig(
                    Room.BadKlein,
                    'BadezimmerKlein',
                    5000,
                    [
                        "B4.M"
                    ],
                    [
                        "A5"
                    ],
                    []
                )
            ]
        )
    );
})();