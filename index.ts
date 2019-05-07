// IDE fix
var console = console;
var setState = setState;
var createState = createState;
var getState = getState;
var on = on;
var getAstroDate = getAstroDate;
//--------------------------------------------

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

function registerHueDimmerButtonEvents(dimmerName:string, dimmerObjectID:string, buttonActions):void {
    on({id: dimmerObjectID, change: "ne"}, function (obj) {

        const buttonEventId: number = obj.state.val;
        const buttonActionsArray = buttonActions[buttonEventId];

        if (!buttonActionsArray){
            return;
        }
        if (buttonActionsArray.length == 0) {
            return
        }

        // 1004 becomes 1000
        const buttonId: number = Math.floor((buttonEventId / 1000)) * 1000;

        const rootStatePath:string = "Sensors.HueDimmer";
        const statePathLastClickedButtonId: string = rootStatePath + "." + dimmerName + "." + "LastClickedButtonId";
        const statePathDoubleClickHistory: string = rootStatePath + "." + dimmerName + "." + buttonEventId;


        createState(statePathDoubleClickHistory, "{\"History\" : []}", () => {
            createState(statePathLastClickedButtonId, buttonId, () =>  {

                const lastClickedButtonId: number = getState(statePathLastClickedButtonId).val;
                setState(statePathLastClickedButtonId, buttonId);

                const doubleClickHistory = JSON.parse(getState(statePathDoubleClickHistory).val);
                if (! (lastClickedButtonId == buttonId)) {
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

                if (doubleClickHistory.History.length >= buttonActionsArray.length) {
                    // Reset cycle on too many presses
                    doubleClickHistory.History = [];
                }

                doubleClickHistory.History.push(Date.now());
                setState(statePathDoubleClickHistory, JSON.stringify(doubleClickHistory));

                // Execute the button Action
                const clickCounter: number = doubleClickHistory.History.length - 1;
                const buttonAction = buttonActionsArray[clickCounter];
                buttonAction.buttonAction();

                // Prevent Motionsensors from overwriting the just set scene.
                const motionSensorOverwrites = buttonAction.motionSensorOverwrites;
                if (motionSensorOverwrites) {
                    for (let i = 0; i < motionSensorOverwrites.length; i++) {
                        const room: string = motionSensorOverwrites[i].room;
                        const durationInMs: number = motionSensorOverwrites[i].durationInMs;

                        RoomLock.createRoomLockStateIfNotExist(room, () => {
                            let lock = new RoomLock(dimmerName, true, durationInMs, 0);
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
            if (!timeOfDayMotionAction) {
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
                        if (! (RoomLock.loadFromState(roomname).turnOffId == turnOffId)) {
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

function getCurrentDayTimePeriodId():string {
    const currentTime:TimeOfDay = TimeOfDay.fromDate(new Date())

    const dayTimePeriods = getDayTimePeriods();

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

class TimeOfDay {
    private minutes:number;

    constructor (
      hour:number,
      minute:number
    ){
      this.minutes = hour * 60 + minute;
    }

    public static fromDate(date:Date):TimeOfDay {
        return new TimeOfDay(date.getHours(), date.getMinutes());
    }

    public addMinutes(minutes:number):TimeOfDay {
        this.minutes += minutes;
        return this;
    }

    public isBefore(timeOfDay: TimeOfDay): boolean {
        return this.minutes < timeOfDay.minutes;
    }
}

class DayTimePeriod {
    constructor(
        public id:string,
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
            "id" : "Morgen",
            "startsAt": new TimeOfDay(5,0)
        },
        {
            "id" : "Tag",
            "startsAt": TimeOfDay.fromDate(goldenHourEnd)
        },
        {
            "id" : "Abend",
            "startsAt": TimeOfDay.fromDate(sunsetStart).addMinutes(-20)
        },
        {
            "id" : "Nacht",
            "startsAt": new TimeOfDay(23,0)
        },
    ]
}

class MotionSensor {
    constructor (
        public sensorName:string,
        public presensEventObjectId:string
    ) {}
}


class DayTimeMotionSensorAction {
    constructor(
        public dayTimePeriod:string,
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


registerHueSensorCoupleMotionEvents("Wohnzimmer", 100,
    [
        {
            "sensorName": "SensorB4",
            "presensEventObjectId":'deconz.0.Sensors.3.presence'
        }
    ],
    {
        "onMotionActions": [
            {
                "dayTimePeriod":"Abend",
                "action": ()=> {
                    console.log("Motion B4 Wohnzimmer Zeit: Abend");
                    setState('hue.0.Hue_01.Wohnzimmer.bri', 255);
                }
            },
            {
                "dayTimePeriod":"Nacht",
                "action": ()=> {
                    console.log("Motion B4 Wohnzimmer Zeit: Nacht");
                    setState('hue.0.Hue_01.Wohnzimmer.bri', 50);
                }
            }
        ],
        "onNoMoreMotionAction": ()=> {
            console.log("No more motion on B4 Wohnzimmer");
            setState('hue.0.Hue_01.Wohnzimmer.bri', 0);
        }
    }
);


var buttonActionWohnzimmer = getDefaultDimmerSwitchButtinActions();
registerHueDimmerButtonEvents("MyHueDimmerSwitch01", 'deconz.0.Sensors.2.buttonevent', buttonActionWohnzimmer);


class RoomLockOverwriteInfo {
    constructor(
       public room:string,
       public durationInMs:number
    ) {}

}
class ButtonAction {
    constructor(
        public motionSensorOverwrites:RoomLockOverwriteInfo[],
        public action:()=>void
    ){}
}

class DimmerSwitchLayout {
    constructor(
        public buttonLayout: DimmerSwitchButtonEventActions[]
    ){}
}

class DimmerSwitchButtonEventActions {
    constructor(
      public eventId:HueDimmerButtonEvents,
      public buttonActions:ButtonAction[]
    ){}
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


function getDefaultDimmerSwitchButtonActions(): DimmerSwitchLayout {
    return {
        buttonLayout: [
            {
                eventId: HueDimmerButtonEvents.ON_BUTTON_UP,
                buttonActions: [
                    {
                        motionSensorOverwrites: [
                            {
                                room: "Wohnzimmer",
                                durationInMs:12
                            }
                        ],
                        action:() => {
                            console.log("ON Button Down Singlepress");
                            setState('hue.0.Hue_01.Wohnzimmer.bri', 254);
                        }
                    }
                ]
            }
        ]
    }
}
