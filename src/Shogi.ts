import "./strategy/Strategy"
import {ShogitterCoreException} from "./utils/phpCompat";
import {Mochigoma, MochigomaObj} from "./Mochigoma";
import {Result, Teban, UserInfo} from "./Teban";
import Ban, {BanObj, Direction, Species} from "./Ban";
import XY, {XYObj} from "./XY";
import {Koma, KomaObj, PromotionMode} from "./Koma";
import Kifu, {KifuLine, KifuMove} from "./Kifu";
import {BanScanIterator} from "./Iterator";
import {Rule, shogitterDB} from "./ShogitterDB";
import {javaHashCode} from "./utils/hash";

export {ShogitterCoreException};

const DEBUG_ECHO_TIME = true;

/*
enum Format {
    FORMAT_UNKNOWN = -1,
    FORMAT_RULEID = 0,
    FORMAT_JSON = 1,
    FORMAT_KIF = 2,
    FORMAT_KI2 = 3,
    FORMAT_CSA = 4,
    FORMAT_XML = 5,
    FORMAT_OBJECT = 100,
}
 */

type StatusObj = {
    num: Status;
    message?: string
}

export enum Status {
    INITIAL,
    PLAYING,
    ENDED,
}
export type Player = {
    // Missing for live board
    // null when it's vacant
    user?: (UserInfo | null)[],
    mochigoma: {[species: string]: number},
    result?: Result,
}

type Game = {
    players: Player[],
}

export interface ShogiSerialization extends Game {
    version: string,
    status: StatusObj,
    ruleid: number,
    teban: number,
    turn: number,
    date: {
        start?: string,
        end?: string
    },
    ban: BanObj,
    moving: Moving,
    players: Player[],
    debug: string,
    system: string,
    kifu: KifuLine[],
}

type Moving = {
    xy: [number, number],
    status: number;
}

export type KifuCommand = {direction?: Direction} & (
    MoveCommand |
    PutCommand |
    RollbackCommand |
    ResignCommand |
    ResetCommand |
    StartCommand |
    PassCommand |
    // ChangeDirectionCommand | // Not used
    DrawCommand);
export type MoveCommand = {
    type: "move",
    from: XYObj,
    to: XYObj,
    nari?: boolean,
}
export type PutCommand = {
    type: "put",
    to: XYObj,
    direction: Direction;
    put: Species,
    id?: number, // Used for quantum shogi to distinguish individual pieces of a kind
}
export type RollbackCommand = {
    type: "rollback",
    direction?: Direction;
}
export type StartCommand = {
    type: "start"
}
export type PassCommand = {
    type: "pass"
}
export type ResignCommand = {
    type: "resign",
}
export type DrawCommand = {
    type: "draw",
}
/*
export type ChangeDirectionCommand = {
    type: "changedirection",
}*/
export type ResetCommand = {
    type: "reset",
    ruleId: number;
}

/**
 * ??????????????????
 */
export default class Shogi {
    ruleid: number;		//???????????????
    //???????????????
    status: StatusObj = {
        num: Status.INITIAL
    };		
    kifu: Kifu;			//????????????????????????
    mochigoma: Mochigoma;		//???????????????????????????
    ban: Ban;			//?????????????????????
    teban: Teban;			//????????????????????????
    rule: Rule;
    moving: Koma | undefined;
    date: {
        start?: Date;
        end?: Date;
    };
    private jsonsystem: any; // Used for showing confirmation
    private end: { status: any; kifu: any[] };
    fromDirection: Direction;
    private lastBan: KomaObj[][];		//????????????????????????(???????????????)
    private lastMochigoma: MochigomaObj[];

    // statusMessage;		//???????????????
    // noCheckOthello;//??????????????????????????????
    // kifulength;	//???????????????
    // debug;

    /*
    static getFormatByFileName(filename: string) {
        const tmp = filename.split(".");
        switch (tmp[tmp.length - 1].toLowerCase()) {
            case 'json':
                return Format.FORMAT_JSON;
            case 'kif':
                return Format.FORMAT_KIF;
            case 'ki2':
                return Format.FORMAT_KI2;
            case 'csa':
                return Format.FORMAT_CSA;
            case 'xml':
                return Format.FORMAT_XML;
            default:
                return Format.FORMAT_UNKNOWN;
        }
    }
     */

    /**
     * ???????????????????????????????????????????????????????????????????????????
     * (???????????????????????????????????????????????????)
     */
    clone(): Shogi {
        return Shogi.ofJkf(this.getObject());
    }

    shufflePlayers() {
        this.teban.shufflePlayers();
    }

    isReady() {
        return this.status.num == Status.INITIAL;
    }

    init() {
        if (this.isPlaying()) throw new ShogitterCoreException("????????????????????????????????????");
        this.status = {num: Status.INITIAL};
        this.date = {}
    }

    start() {
        if (!this.isReady()) throw new ShogitterCoreException("??????????????????????????????????????????????????????");
        this.status = {num: Status.PLAYING};
        // this.date['start'] = new Date();
    }

    /**
     * If a move is already made.
     * TODO: This should only check the status once we have a proper UI for starting games
     */
    isPlaying() {
        return this.status['num'] == Status.PLAYING;
    }

    isEnded() {
        return this.status['num'] == Status.ENDED;
    }

    getRuleName() {
        return this.rule['name'];
    }

    getPromoted(species: Species, mode: PromotionMode) {
        for (let name in this.rule['nari']) {
            const value = this.rule.nari[name];
            if ((mode == PromotionMode.FRONT || mode == PromotionMode.FLIP) && species == value) {
                return name;
            }
            if ((mode == PromotionMode.BACK || mode == PromotionMode.FLIP) && species == name) {
                return value === null ? name : value;
            }
        }
        return species;
    }

    public static ofJkf(jkf: ShogiSerialization): Shogi {
        const shogi = new Shogi();
        shogi.constructByJSON(jkf);
        return shogi;
    }

    public static ofRuleId(ruleId: number): Shogi {
        const shogi = new Shogi();
        shogi.constructById(ruleId);
        return shogi;
    }

    /**
     * ????????????
     */
    constructor() {
        /* case Format.FORMAT_XML:
             this.constructByXml(data);
             break;
         case Format.FORMAT_CSA:
             this.constructByCSAFormat(data);
             break;
         case Format.FORMAT_KIF:
             this.constructByKakinokiFormat(data);
             break;
         case Format.FORMAT_KI2:
             this.constructByKakinoki2Format(data);
             break;
         */
    }

    /*
    constructByKakinoki2Format(data, nocheckoute=false){
        const lines =explode("\n", data);
        let ruleid=0;
        let constructed=false;
        for(let line of lines){
    //			print linecnt++.line;
            line=rtrim(line);
            if(line=="") continue;
            if(mb_substr(line,0,1)=="*"){
                //???????????????
                tesuu=constructed?this.kifu.getTesuu():0;
                comment=mb_substr(line,1);
                comments[tesuu]=comments[tesuu]!=null?"{comments[tesuu]}\n{comment}":comment;
                continue;
            }
            if(mb_substr(line,0,1)=="#") continue;
            if(preg_match("/^(.*)???(.*)/u", line, matches)){
                switch(matches[1]){
                    case "????????????":
                        info['date']=matches[2];
                        break;
                    case "??????":
                        info['kisen']=matches[2];
                        break;
                    case "??????":
                        info['teai']=matches[2];
                        ruleid=teai2ruleid(matches[2]);
                        break;
                    case "??????":
                        info['senkei']=matches[2];
                        break;
                    case "??????":
                        info['bikou']=matches[2];
                        break;
                    case "??????":
                    case "??????":
                        info['players'][0]=matches[2];
                        break;
                    case "??????":
                    case "??????":
                        info['players'][1]=matches[2];
                        break;
                    case "??????":
                        info['place']=matches[2];
                        break;
                    case "????????????":
                        info['jikan']=matches[2];
                        break;
                    default:
                        unknown[matches[1]]=matches[2];
                }
                continue;
            }else if(preg_match_all("/([??????])(([???-???])([???????????????????????????])|???????)(????.)([??????]?)([????????????]?)(??????|[??????]?)/u", line, matches)){
                if(!constructed){
                    constructed=true;
                    if(DEBUG_ECHO_TIME) time=getmicrotime();
                    this.constructById(ruleid);
                    this.start();
                    if(nocheckoute){
                        this.rule['strategy']['Judge']['Oute']['ignore']=true;
                    }
                    if(DEBUG_ECHO_TIME) echo "construct: ".(getmicrotime()-time)."<br>";
                }
                foreach(matches[0] as key => value){
                    if(DEBUG_ECHO_TIME) time=getmicrotime();
                    try{
                        echo "(", matches[1][key], matches[3][key], matches[4][key], matches[5][key], matches[6][key], matches[7][key], matches[8][key], ")";
                        this.moveByKifu(matches[1][key], matches[3][key], matches[4][key], matches[5][key], matches[6][key], matches[7][key], matches[8][key]);

                    }catch(Exception e){
                        die("<pre>??????".e.getMessage().e.getTraceAsString().this.getFormat());
                    }
                    kifu[this.kifu.getTesuu()]=this.getEncodedFormat();

                    if(DEBUG_ECHO_TIME) echo "move({matches[0][key]}): ".(getmicrotime()-time)."<br>";
                    count++;
                }
            }else if(preg_match("/??????(\d+)??????([????????????]???)?????????/u", line, matches)){
                info['tesuu']=matches[1];
                info['result']=matches[2];
            }else{
                throw new Exception("??????????????????????????????");
            }
        }
        if(nocheckoute){
            echo "<pre>".this.getFormat();
            echo "<textarea>".this.getJSONFormat()."</textarea>";
            print_r(info);
            print_r(comments);
            print_r(kifu);
            print_r(unknown);
        }
    }*/
    /**
     * ??????????????????????????????????????????????????????
     * @param <type> data
     */
    /*
    constructByKakinokiFormat(data){

        preg_match_all("/????????????(.*?)\n/u", data, matches);
        if(count(matches[1])>0){
            ruleid=this.teai2ruleid(str_replace("???","", matches[1][0]));
        }else{
            ruleid=0;
        }
        preg_match_all("/([???-???][???????????????????????????]|??????)(????.)(????)(\(\d{2}\)|???)/u", data, matches);
    //		print_r(matches);

        this.constructById(ruleid);
        this.start();

        foreach(matches[0] as tesuu => tmp){
            kifu=array();
            if(matches[4][tesuu][0]=="("){
                kifu['from']=array((int)substr(matches[4][tesuu], 1, 1), (int)substr(matches[4][tesuu], 2, 1));
                if(matches[3][tesuu]==""){
                    kifu['nari']=false;
                }else{
                    kifu['nari']=true;
                }
            }else{
                foreach(this.mochigoma.arrayMochigoma as mochigoma){
    //					echo mochigoma.species;
                    if(Koma.getData(mochigoma.species, 'shortname')==matches[2][tesuu]){
                        kifu['put']=mochigoma.species;
                        ok=true;
                        break;
                    }
                }
                if(!ok) die("???????????????????????????????????????");
            }
            if((tox=mb_substr(matches[1][tesuu],0,1))=="???"){

            }else{
                toy=mb_substr(matches[1][tesuu],1,1);
                lastto=Shogi.numerize(tox).Shogi.numerize(toy);
            }
            kifu['to']=lastto.getArray();

            this.move_d(kifu);
        }
    }*/
    /**
     * CSA????????????????????????????????????????????????
     * @param <type> data
     */

    /*
    constructByCSAFormat(data){
        preg_match_all("/N[+-].*?\n/", data, matches);
        if(count(matches[0])>0){
            foreach(matches[0] as name){
                name=rtrim(name);
                if(name[1]=="+"){
                    this.teban.setPlayerName(0, 0, substr(name,2));
                }else if(name[1]=="-"){
                    this.teban.setPlayerName(1, 0, substr(name,2));
                }
            }
        }

        preg_match_all("/[+-]\d{4}[A-Z]{2}/", data, matches);
        this.constructById(0);
        i=1;
        this.start();
        foreach(matches[0] as kifu){
            csaname=substr(kifu, 5, 2);
            if(kifu[1]==0 && kifu[2]==0){
                //??????????????????
                foreach(this.mochigoma.arrayMochigoma as mochigoma){
                    if(!this.teban.isDirection(mochigoma.direction)) continue;
                    if(Koma.getData(mochigoma.species, 'csaname')!=csaname) continue;
                    this.move_d(array('put'=>mochigoma.species, 'to'=>array(kifu[3], kifu[4])));
                    break;
                }
            }else{
                XY=new XY(kifu[1], kifu[2], this.ban);
                if(!this.ban.exists(XY)){
    //					print_r(matches);
                    die("{i}??????????????????({kifu[1]},{kifu[2]})???????????????????????????");
                }
                if(Koma.getData(this.ban.get(XY).species, 'csaname')!=csaname){
                    //?????????????????????
                    this.move_d(array('from'=>array(kifu[1], kifu[2]), 'to'=>array(kifu[3], kifu[4]), true));
                }else{
                    //?????????????????????
                    this.move_d(array('from'=>array(kifu[1], kifu[2]), 'to'=>array(kifu[3], kifu[4]), false));
                }
            }
            i++;
        }
    }
     */
    /**
     * ?????????id?????????????????????????????????
     * @param <type> ruleid
     */
    constructById(ruleid: number) {
        this.rule = shogitterDB.getRule(ruleid);
        this.ruleid = ruleid;
        this.kifu = new Kifu(this);
        this.mochigoma = new Mochigoma(this);
        this.init();
        this.teban = new Teban(0, this.rule['players'], this, this.teban);
        this.teban.setFlags({'komaochi': this.rule['komaochi']});

        this.ban = new Ban(this.rule['size'][0], this.rule['size'][1], this, this.rule.strategy || {}, this.rule.iterator || {});
        this.ban.deserialize({});
        this.mochigoma.setStrategy(this.rule['strategy'] || {});
        //this.kifulength = strlen(max(this.rule['size'][1], this.rule['size'][0])); // TODO what does it mean?

        //??????????????????????????????????????????
        this.ban.update(this.rule.init.ban);
        this.mochigoma.update(this.rule.init.mochigoma);
        this.kifu.clear();
    }

    constructByJSON(arr: ShogiSerialization) {
        this.constructById(arr['ruleid']);
        this.status = arr.status;
        this.date = {
            start: new Date(arr.date?.start),
            end: new Date(arr.date?.end)
        };
        this.teban.setMaxTurn(arr.players[0].user?.length || 0);
        this.teban.set(arr.teban);
        this.teban.setTurn(arr.turn);
        this.jsonsystem = arr.system;
        this.ban.deserialize(arr.kifu?.[arr.kifu.length - 1]?.data || {});

        this.ban.updateByJSON(arr.ban);
        this.mochigoma.updateByJSON(arr.players);
        this.setMoving(arr.moving);

        this.teban.setArrayPlayerInfo(arr.players);

        this.kifu.updateByJSON(arr.kifu);
    }

    /**
     * XML?????????????????????????????????
     * @param <type> rawdata
     */

    /*
    constructByXml(rawdata){

        xml=new SimpleXMLElement(rawdata);
        ruleid=(int)xml.status["ruleid"];

        this.constructById(ruleid);

        this.teban.set(xml.status["teban"]);
        this.status=array(
            'num'=>(int)xml.status["id"],
            'message'=>(string)xml.status
    );

        //?????????????????????????????????
        this.ban.updateByXML(xml.ban);

        //?????????????????????????????????
        foreach(xml.players.player as player){
            this.teban.setPlayerName((int)player['dir'], 0, (string)player['name']);
            foreach(player.mochigoma as mochigoma){
                max=(int)mochigoma['value'];
                for(i=0;i<max;i++){
                    this.mochigoma.add((string)mochigoma['spe'], (int)player['dir']);
                }
            }
        }

        //??????????????????
        foreach(xml.kifus.kifu as kifu){
            if(isset(kifu['dir'])){
                tmp=(int)kifu['dir'];
                foreach(kifu.masu as masu){
                    tmp.=sprintf("%0{this.kifulength}d%0{this.kifulength}d", masu['x'], masu['y']);
                    if(isset(masu['fromspe'])){
                        tmp.=(string)masu['fromdir'].(string)masu['fromspe'];
                    }else{
                        tmp.="___";
                    }
                    if(isset(masu['tospe'])){
                        tmp.=(string)masu['todir'].(string)masu['tospe'];
                    }else{
                        tmp.="___";
                    }
                }
                foreach(kifu.mochigoma as mochigoma){
                    value=(int)mochigoma['value'];
                    spe=(string)mochigoma['spe'];
                    dir=(int)mochigoma['dir'];
                    if(value>0){
                        tmp.="_+".sprintf("%02d", value).dir.spe;
                    }else{
                        value=-value;
                        tmp.="_-".sprintf("%02d", value).dir.spe;
                    }
                }

            }else{
                tmp="";
                foreach(kifu.player as player){
                    if((string)player['result']=='lose'){
                        tmp.="_".(int)player['dir'];
                        break;
                    }
                }
            }
            this.kifu.add(tmp, (string)kifu['value'], array('hash'=>true));
        }
    }

     */
    setMoving(moving: Moving): void {
        if (!moving) return null;
        const xy = new XY(moving['xy'][0], moving['xy'][1]);
        this.ban.ensureExists(xy);
        const koma = this.ban.get(xy);
        koma.status = moving['status'];
        this.moving = koma;
    }

    /**
     * ????????????
     * @param <type> direction
     */
    resign(direction?: Direction) {
        if (!this.isPlaying()) throw new ShogitterCoreException("?????????????????????????????????");
        let dirResign;
        if (typeof direction !== "undefined") {
            //???????????????????????????????????????
            dirResign = direction;
        } else {
            //????????????????????????????????????
            dirResign = this.teban.getNowDirection();
        }
        this.gameEnd(dirResign, dirResign, "??????", `${this.teban.getName(dirResign)}????????????????????????`);
        this.gameEndFinalize();
        this.teban.rotate();
    }

    /**
     *
     */
    draw() {
        if(!this.isPlaying()) throw new ShogitterCoreException("????????????????????????????????????????????????");
        this.gameEnd(9, 9, "????????????", "???????????????????????????");
        this.gameEndFinalize();
    }

    /**
     * n?????????
     * @param <type> number
     */
    rollback(number: number) {
        if(!this.isPlaying()) throw new ShogitterCoreException("????????????????????????????????????????????????");
        const max = this.kifu.getTesuu();
        if (max <= 0) throw new ShogitterCoreException("????????????????????????????????????????????????");
        let te = 1;
        let teban;
        while (te <= number) {
            const thiskifu = this.kifu.get(max - te);

            const now = 1;
            teban = thiskifu[0];
            if (teban === "_") {
                //??????????????????????????????????????????
                number++;
            } else {
                for (let value of this.kifu.getDataByKifu(thiskifu)) {

                    if (value['value']) {
                        //?????????
                        this.mochigoma.add(value.species, value.direction, value.value * -1);
                    } else {
                        //????????????
                        if (value.before.direction === null/* === "_"*/) {
                            this.ban.remove(value['XY']);
                        } else {
                            this.ban.add(value['XY'], value['before'].species, value['before'].direction);
                        }
                    }
                }
            }
            this.kifu.remove();
            te++;
            if (this.kifu.getLastMoving()) number++; //?????????????????????????????????
            this.moving = null;
        }
        this.teban.set(teban as number);
    }

    /*
    moveByKifu(mark, x, y, species, relative, movement, nari) {
        const direction = Teban.mark2direction(mark);
        try {
            x = Shogi.numerize(x);
            y = Shogi.numerize(y);
        } catch (e) {
            x = y = 0;
        }
        species = Koma.name2species(species);

        let to;
        if (x == 0) {
            const tmp = this.kifu.getXYByTesuu(this.kifu.getTesuu() - 1);
            to = tmp['to'];
        } else {
            const toy = y;
            to = new XY(x, y, this.ban);
        }

        let movable = this.ban.arrayKikiKoma(to, species, direction);
        const count = movable.length;
        let from;
        if (count > 0 && nari != "???") {
            if (count == 1) {
                from = movable[0];
            } else {
                if (movement == "???") {
                    movable = movable
                        .filter(kiki => kiki['XY'].x == to.x)
                        .filter(kiki => direction == 0 ? kiki['XY'].y > to.y : kiki['XY'].y < to.y);
                }
                if ((species == "am" || species == "an")) {
                    if (movable.length < 2) {

                    } else if ((direction == 0 && relative == "???") || (direction == 1 && relative == "???")) {
                        movable = movable[0]['XY'].x < movable[1]['XY'].x ? [movable[0]] : [movable[1]];
                    } else if ((direction == 0 && relative == "???") || (direction == 1 && relative == "???")) {
                        movable = movable[0]['XY'].x < movable[1]['XY'].x ? [movable[1]] : [movable[0]];
                    }
                } else {
                    if ((direction == 0 && relative == "???") || (direction == 1 && relative == "???")) {
                        movable = movable.filter(kiki => to.x > kiki['XY'].x);
                    } else if ((direction == 0 && relative == "???") || (direction == 1 && relative == "???")) {
                        movable = movable.filter(kiki => kiki['XY'].x > to.x);
                    }
                }

                if ((direction == 0 && (movement == "???" || movement == "???")) || (direction == 1 && movement == "???")) {
                    movable = movable.filter(kiki => to.y < kiki['XY'].y);
                } else if ((direction == 0 && movement == "???") || (direction == 1 && (movement == "???" || movement == "???"))) {
                    movable = movable.filter(kiki => to.y > kiki['XY'].y);
                } else if (movement == "???") {
                    movable = movable.filter(kiki => kiki['XY'].y == to.y);
                }
                if (movable.length == 1) {
                    from = movable.pop();
                } else {
                    throw new Exception(`????????????????????????mark, x, y, (to: debug) species, relative, movement, nari ????????????${movable.length}????????????`);
                }
            }
            return this.move_d({
                'from': from['XY'].getArray(),
                'to': to.getArray(),
                'nari': (nari == "???")
            });
        }

        if (this.mochigoma.exists(species, direction)) {
            return this.move_d({'put': species, 'to': to.getArray()});
        } else {
            throw new Exception(`????????????????????? ${this.kifu.getTesuu()}??????: {kifu} ???????????????????????????`);
        }
    }
     */

    gameEnd(loseDirection: Direction, markDirection: Direction, kifu: string, description: string) {
        if (this.end) {
            throw new ShogitterCoreException(`????????????????????????????????????????????????: ${this.end.status}, ${description}`);
        }
        this.end = {'status': description, 'kifu': [`_${loseDirection}`, Teban.getMark(markDirection) + kifu]};
    }

    gameEndFinalize() {
        if (!this.end) return;

        this.status = {'num': 2, 'message': this.end['status']};
        this.kifu.add(this.end['kifu'][0], this.end['kifu'][1]);
        // this.date['end'] = new Date();
        const loseDirection = this.end['kifu'][0][1];
        for (let direction of this.teban.getIterator()) {
            this.teban.setResultToPlayer(direction, direction == loseDirection ? Result.LOSE : Result.WIN);
        }
        this.end = null;
    }

    ensureNoMoving(from: XY = null) {
        //????????????????????????????????????????????????????????????????????????????????????
        if (this.moving && (from === null || !this.moving.XY.equals(from))) {
            throw new ShogitterCoreException('?????????????????????????????????????????????????????????');
        }
    }

    move(from: XY, to: XY, nari = false, direction?: Direction) {
        let fromDirection;
        this.fromDirection = fromDirection = this.ban.get(from).direction;
        if (typeof direction !== "undefined" && fromDirection !== direction) {
            throw new ShogitterCoreException("It's not your turn");
        }
        this.teban.ensureDirection(fromDirection);

        //??????????????????
        this.lastBan = this.ban.getArray();
        this.lastMochigoma = this.mochigoma.getArray();

        //?????????????????????????????????
        const movingTypes = this.ban.get(from).ensureMovable(to);

        //???????????????
        this.ensureNoMoving(from);

        this.ban.strategy['Destination'].executeBefore(from, to);

        //?????????postfix???????????????
        const record = {
            mark: this.teban.getNowMark(),
            name: this.ban.get(from).getShortName(),
            postfix: this.ban.makePostfix(from, to),
            naripostfix: ""
        };

        this.ban.strategy['MoveControl'].executeBefore(from);
        this.ban.strategy['MoveEffect'].executeBefore(from);
        this.ban.strategy['CaptureControl'].execute(this.ban.get(to), this.ban.get(from));

        //??????????????????
        const fromPick = this.ban.take(from);

        //????????????????????????????????????????????????
        const captured = this.ban.strategy['Capture'].execute(to, fromDirection);

        //???????????????????????????
        if (movingTypes.indexOf(100) >= 0) {
            for (let xy of BanScanIterator.getBetween(this.ban, from, to)) {
                if (this.ban.get(xy).isNull()) continue;
                this.ban.strategy['Capture'].execute(xy, fromDirection);
            }
        }

        //??????????????????
        this.ban.set(to, fromPick);

        //?????????????????????????????????
        fromPick.changeStatus(movingTypes, captured);

        record.naripostfix = this.ban.strategy.Promotion.execute(to, from, captured, nari) || "";
        this.ban.strategy['MoveEffect'].executeAfter(to, captured);

        //this.ban.strategy['Destination'].executeAfter(to);

        this.ban.strategy['MoveControl'].executeAfter(to);
        this.ban.strategy.Nifu.execute(to);
        this.ban.strategy.Judge.execute(to);

        const lastXY = this.kifu.getXYByTesuu(this.kifu.getTesuu() - 1);
        this.kifu.add(
            this.makeKifu(to, from),
            `${record.mark}${lastXY && to.equals(lastXY.to) ? "???" : to.getFormat()}${record.name}${record.postfix}${record.naripostfix}`,
            {'hash': true}
        );
        this.ban.strategy['TebanRotation'].execute(this.moving, this.ban.strategy['Promotion'].flag, captured, to, from);

        this.gameEndFinalize();
    }

    put(to: XY, species: Species, direction: Direction, id?: number) {
        //??????????????????
        this.fromDirection = direction;
        this.teban.ensureDirection(direction);
        this.lastBan = this.ban.getArray();
        this.lastMochigoma = this.mochigoma.getArray();

        //???????????????
        this.ensureNoMoving();

        this.ban.strategy['Destination'].executeDrop(to, species, direction);

        const kifu2 = this.makePutKifuString(to, species);

        this.mochigoma.strategy['MochigomaIO'].executeOut(species, direction);
        this.ban.ensureNotExists(to);
        this.ban.setAdd(to, species, direction);

        this.ban.strategy.Promotion.executeLegal(to);

        this.ban.strategy.MoveEffect.executeDrop(to, id);
        this.ban.strategy.MoveControl.executeDrop(to);
        this.ban.strategy.Nifu.execute(to);

        this.ban.strategy.Judge.execute(to, true);

        this.kifu.add(
            this.makeKifu(to, null),
            kifu2,
            {'hash': true}
        );

        this.teban.rotate();
        this.gameEndFinalize();
    }

    shouldAskPromotion(to: XY, from: XY) {
        const captured = this.ban.exists(to);
        const direction = this.ban.get(from).direction;
        return this.ban.strategy.Promotion.shouldAskPromotion(to, from, captured, direction);
    }

    /**
     * ???????????????????????????move
     * @param command
     */
    runCommand(command: KifuCommand) {
        switch(command.type) {
            case "reset":
                this.constructById(command.ruleId);
                return;
            case "start":
                this.start();
                return;
            case "draw":
                this.draw();
                return;
            case "pass":
                if (typeof command.direction === "number") {
                    this.teban.ensureDirection(command.direction);
                }
                this.pass();
                return;
                /*
            case "changedirection":
                if(this.isPlaying()) throw new ShogitterCoreException("??????????????????????????????????????????");
                this.teban.changeDirection();
                return;
                 */
        }

        if (this.isEnded()) {
            throw new ShogitterCoreException("?????????????????????????????????");
        }
        if (command.type === "resign") {
            return this.resign(command.direction);
        }
        if (command.type === "rollback") {
            const amount = typeof command.direction !== "undefined" && this.teban.getNowDirection() === command.direction ? 2 : 1;
            return this.rollback(Math.min(amount, this.kifu.getTesuu()))
        }
        if (typeof command.direction === "number") {
            this.teban.ensureDirection(command.direction);
        }
        switch (command.type) {
            case "move":
                return this.move(
                    new XY(command.from[0], command.from[1]),
                    new XY(command.to[0], command.to[1]),
                    command.nari
                );
            case "put":
                return this.put(
                    new XY(command.to[0], command.to[1]),
                    command.put,
                    command.direction,
                    command.id
                );
            default:
                throw new ShogitterCoreException("Unknown command type: "+(command as any).type, 1);
        }
        return true;
    }

    /**
     * lastBan???ban?????????????????????????????????
     * @return <type>
     * @param to
     * @param from ???????????????null
     */
    makeKifu(to: XY, from?: XY): KifuMove {
        const diffs = [...this.ban.getDifference(this.lastBan, to, from),
            ...this.mochigoma.getDifference(this.lastMochigoma)]
        return [this.teban.get(), ...diffs];
    }

    /**
     * ???????????????????????????????????????
     * @param <type> sashite
     */
    makePutKifuString(to: XY, species: Species) {
        const direction = this.teban.getNowDirection();

        //???????????????????????????????????????????????????????????????????????????????????????
        let utu = "";
        for (let kiki of this.ban.arrayKikiInSpeDir(species, false, direction, false, false)) {
            if (kiki['XY'].equals(to)) {
                utu = "???";
                break;
            }
        }
        const name = Koma.getStatelessData(species, 'shortname') || Koma.getStatelessData(species, 'name');//?????????????????????????????????
        return Teban.getMark(direction) + to.getFormat() + name + utu;
    }

/////////////////////////////////????????????
    /**
     * ????????????????????????????????????????????????????????????????????????
     * @return <type>
     */
    pass() {
        if (this.moving == null) {
            if (this.ban.strategy['TebanRotation'].canPass()) {
                this.kifu.unsetLastMoving();
                this.teban.rotate();
            } else {
                throw new ShogitterCoreException("?????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????");
            }
        } else {
            if (this.ban.get(this.moving.XY).get("nopass")) {
                throw new ShogitterCoreException("???????????????????????????????????????????????????");
            } else {
                this.kifu.unsetLastMoving();
                this.moving = null;
                this.teban.rotate();
            }
        }
    }

    /**
     * ??????????????????????????????????????????
     */
    /*
    getFormat() {
        return this.ruleid + "\n"
            + this.status.join("|") + "\n"
            + this.teban.get() + "\n"
            + this.ban
            + this.mochigoma
            + this.kifu;
    }
     */

    getKyokumen() {
        return this.ban.__toString() + this.mochigoma.__toString();
    }

    getHash() {
        return javaHashCode(this.getKyokumen()).toString(16);
    }

    /*
    getHTMLFormat(tesuu){
        ret="<html><head><title>??????????????? ??????</title></head><body>";

        mochigoma=this.mochigoma.getArray();
        ret="<font color='red'>?????????";
        if(count(mochigoma[1])>0){
            foreach(mochigoma[1] as species => value){
                ret.= Koma.getData(species, 'shortname').(value>1?num2kan_decimal(value):"");
            }
        }else{
            ret.= "??????";
        }
        ret.= "</font><br>";

        ret.=this.ban.sprintf(function(species, direction){
            if(species==null){
                name="???";
            }else{
                name=Koma.getData(species, 'shortname');
            }

            if(direction==1){
                return "<font color='red'>".name."</font>";
            }else{
                return name;
            }
        }, "<br>\n");

        ret.= "?????????";
        if(count(mochigoma[1])>0){
            foreach(mochigoma[0] as species => value){
                ret.= Koma.getData(species, 'shortname').(value>1?num2kan_decimal(value):"");
            }
        }else{
            ret.= "??????";
        }
        ret.="<br><a href='?tesuu=".this.kifu.getTesuu()."'>??????</a>(20??????????????????)<br>";
        ret.="<a href='?'>??????????????????</a><br>".(tesuu==0?"????????????????????????":"{tesuu}????????????????????????");
        ret.=this.kifu.getString(tesuu?tesuu:0);
        return ret."</body></html>";
    }
     */
    getObject(): ShogiSerialization {
        let moving: Moving;
        if (this.moving) {
            moving = {xy: this.moving.XY.getArray(), 'status': this.moving.status};
        } else {
            moving = null;
        }
        const ban: BanObj = [];
        for (let i = 1; i <= this.rule['size'][0]; i++) {
            ban.push([]);
            for (let j = 1; j <= this.rule['size'][1]; j++) {
                const koma = this.ban.get(new XY(i, j));
                if (koma.isNull()) {
                    ban[i - 1][j - 1] = [];
                } else {
                    ban[i - 1][j - 1] = [koma.direction, koma.species];
                }
            }
        }
        const players = this.teban.getArrayPlayerInfo();
        const mochigoma = this.mochigoma.getArray();
        const playersWithMochigoma: Player[] = [];
        for (let direction of this.teban.getIterator()) {
            playersWithMochigoma[direction] = {...players[direction], mochigoma: {}} || {
                user: [{name: "", id: ""}],
                mochigoma: {}
            }
            playersWithMochigoma[direction].mochigoma = {};
            for (let species in mochigoma[direction]) {
                playersWithMochigoma[direction].mochigoma[species] = mochigoma[direction][species];
            }
        }

        // const max = this.kifu.getTesuu();
        const kifu = this.kifu.getArray();

        const debug = ""/*this.debug.serialize(this)*/;
        const system = this.jsonsystem;
        return {
            version: "0.0",
            status: this.status,
            ruleid: this.ruleid,
            teban: this.teban.get(),
            turn: this.teban.getTurn(),
            date: {
               /* start: this.date.start?.toISOString(),
                end: this.date.end?.toISOString()*/
            },
            ban,
            moving,
            players: playersWithMochigoma,
            debug,
            system,
            kifu
        };
    }

    getJSONFormat(): string {
        return JSON.stringify(this.getObject());
    }

    getLoser() {
        const kifu = this.kifu.get(this.kifu.getTesuu() - 1);
        if (kifu[0] !== "_") throw new ShogitterCoreException("?????????????????????????????????????????????");
        return kifu[1];
    }

    getEncodedXY(x: number, y: number) {
        return (x - 1) * 9 + y - 1;
    }

    /*
    getEncodedFormat(){
        //???????????????
        const encoded=this.ban.getEncodedFormat();
        const ret="";
        const koma=[
            [4, "ag"],
            [4, "af"],
            [4, "ae"],
            [4, "ad"],
            [4, "ac"],
            [4, "ab"],
            [18, "aa"]
        );
        mochigoma=this.mochigoma.getArray();
        foreach(encoded as i => section){
            section=array_map(function(value){
                return array(5, value);
            }, section);
            section[]=array(koma[i][0], mochigoma[0][koma[i][1]]?mochigoma[0][koma[i][1]]:0);
            if(i==6) section[]=array(1, this.teban.get());
            ret.=binhex(binstringify(mergeBits(section), 64))." ";
        }
        return ret;
    }

     */
    /**
     * ????????????????????????????????????????????????????????????
     * @return type
     */
    /*
    getEncodedFormat2(){
        komaarr=array(
            '__'=>"0",
            'ab'=>"100",//???
            'ae'=>"101",//???
            'ac'=>"1100",//???
            'ad'=>"1101",//???
            'ag'=>"1110",//???
            'af'=>"11110",//???
            'am'=>"1111100",//???
            'an'=>"1111101",//???
            'ai'=>"1111110",//???
            'ak'=>"11111110",//??????
            'al'=>"111111110",//??????
            'aj'=>"111111111",//??????
    );

        fudan=array(
            3=>"0",
            4=>"10",
            5=>"110",
            0=>"1110",//??????
            6=>"11110",
            2=>"111110",
            7=>"1111110",
            8=>"11111110",
            1=>"11111111",
    );

        for(i=1; i<=this.rule['size'][0]; i++){
            fu=array(0, 0);
            for(j=1; j<=this.rule['size'][1]; j++){
                XY=new XY(i, j, this.ban);
                koma=this.ban.get(XY);
                switch(koma.species){
                    case 'aa':
                        fu[koma.direction]=this.ban.calcDan(XY, 1-koma.direction);
    //						banmen.=" ".komaarr['__'];
                        break;
                    case 'ah':
                        ou[koma.direction]=this.getEncodedXY(i, j);
                        //					encoded.addOu(this.getEncodedXY(i, j), koma.direction);
    //						banmen.=" ".komaarr['__'];
                        break;
                    case null:
                        //					encoded.addBanmenSpace();
                        banmen.=komaarr['__'];
                        break;
                    default:
                        //					encoded.addBanmen(koma);
                        banmen.=komaarr[koma.species].koma.direction;
                }
            }
            foreach(array(0,1) as direction){
                //			encoded.addFu(fu[direction], direction);
                //echo "{i}??? direction, {fu[direction]};";
                fus[direction].=fudan[fu[direction]];
            }
        }
        //	echo "<br>".encoded.dump();
        bin=(this.teban.get()).fus[0].fus[1].sprintf("%07s", decbin(ou[0])).sprintf("%07s", decbin(ou[1])).banmen.this.mochigoma.getEncodedFormat();
        //echo "fu0:".fus[0]." fu1:".fus[1].";";
        return binhex(bin);
        //"<br>".bin64(bin)
    }

     */
    /**
     * ??????????????????????????????????????????
     * @param <type> format
     * @return <type>
     */
    /*
    getKakinokiFormat(format){
        if(this.teban.getMaxTeban()!=2){
            throw new Exception("?????????????????????????????????????????????????????????????????????????????????????????????");
        }
        if(format==1){
            //?????????
            foreach(array(1,0) as player){
                mochigoma[player]=2;
            }
            return="# ----  ??????????????? http://shogitter.com ??????????????????????????????  ----\n"
                ."???????????????2010/01/01(???) 00:00:00\n"
                ."???????????????2010/01/01(???) 00:00:00\n"
                ."??????????????????\n"
                ."?????????".this.teban.getJoinedPlayerName(0)."\n"
                ."?????????".this.teban.getJoinedPlayerName(1)."\n"
                ."??????----??????---------????????????--\n";
            max=this.kifu.getTesuu();
            for(i=0;i<max;i++){
                tmp=sprintf("%4s", i+1)." ";
                kifu=mb_convert_kana(this.kifu.getKifu(i),"N");
                kifu=str_replace("???", "??????", kifu);
                kifu=preg_replace("/^(???|???)/", "", kifu);
                kifu=preg_replace("/(???|???|???|???|???|???)*BOGUSBOGUSBOGUSBOGUSBOGUSBOGUSBOGUSBOGUS/", "", kifu);
                jmax=9-mb_strlen(kifu)*2;
                kifudata=this.kifu.getDataByTesuu(i);
                if(kifudata['teban']==="_"){
                    jmax+=4;
                }else if(kifudata['koma']){
                    kifu.="???";
                    jmax+=2;
                }else{
                    kifu.="(".kifudata['from']['XY'].x.kifudata['from']['XY'].y.")";
                }

                for(j=0;j<jmax;j++){
                    kifu.=" ";
                }
                return.=tmp.kifu."( 0:00/00:00:00)\n";
            }
        }else{
            //?????????
            return="???????????????2010/01/01(???) 00:00:00\n"
                ."???????????????2010/01/01(???) 00:00:00\n";
            max=this.kifu.getTesuu();
            for(i=0;i<max;i++){
                kifu=mb_convert_kana(this.kifu.getKifu(i),"N");
                kifu=str_replace("???", "??????", kifu);
                jmax=12-mb_strlen(kifu)*2;
                for(j=0;j<jmax;j++){
                    kifu.=" ";
                }
                if(i%6==0) return.="\n";
                return.=sprintf("%-12s", kifu);
            }
        }
        return return;
    }
    */
    /**
     * CSA????????????????????????????????????
     * @return <type>
     */
    /*
    getCSAFormat(){
        return="' ------------ CSA????????????????????????\n"
            ."' -- ??????????????? http://shogitter.com\n"
            ."N+".this.teban.getJoinedPlayerName(0)."\n"
            ."N-".this.teban.getJoinedPlayerName(1)."\n"
            .(this.teban.isDirection(0)?"+":"-")."\n";
        max=this.kifu.getTesuu();
        if(is_array(this.kifu.get(0))){
            for(i=0;i<max;i++){
                kifu=this.kifu.get(i);
                if(kifu[0]==="_"){
                    tmp="%TORYO";
                }else{
                    if(kifu[0]=="0"){
                        tmp="+";
                    }else{
                        tmp="-";
                    }
                    if(count(kifu[2])==3){
                        tmp.="00";
                    }else{
                        tmp.=kifu[2][0].kifu[2][1];
                    }
                    toxy=kifu[1][0].kifu[1][1];
                    tospe=kifu[1][3][1];
                    tmp.=toxy.Koma.getData(tospe, 'csaname');
                }
                return.=tmp.",T0\n";
            }
        }else{
            //?????????????????????
            for(i=0;i<max;i++){
                kifu=this.kifu.get(i);
                if(kifu[0]==="_"){
                    tmp="%TORYO";
                }else{
                    if(kifu[0]=="0"){
                        tmp="+";
                    }else{
                        tmp="-";
                    }
                    fromxy=substr(kifu,9,2);
                    toxy=substr(kifu,1,2);
                    tospe=substr(kifu,7,2);
                    tmp.=(fromxy[0]==="_"?"00":fromxy).toxy.Koma.getData(tospe, 'csaname');
                }
                return.=tmp.",T0\n";
            }
        }
        return return;
    }

     */
    /**
     * ???????????????ruleid?????????
     * @param <type> teai
     * @return <type>
     */

    /*
    static teai2ruleid(teai){
        if(preg_match("/??????/", teai)) return 0;
        if(preg_match("/????????????/", teai) ||preg_match("/?????????/", teai)) return 4;
        if(preg_match("/??????/", teai)) return 1;
        if(preg_match("/??????/", teai)) return 2;
        if(preg_match("/??????/", teai) || preg_match("/?????????/", teai)) return 3;
        if(preg_match("/?????????/", teai)) return 5;
        if(preg_match("/?????????/", teai)) return 6;
        if(preg_match("/?????????/", teai)) return 7;
        if(preg_match("/?????????/", teai)) return 8;
        if(preg_match("/?????????/", teai)) return 9;
        if(preg_match("/?????????/", teai)) return 10;
        if(preg_match("/??????/", teai) || preg_match("/??????/", teai)) return 10;
        return 0;
    }

     */
    static numerize(string: string) {
        switch (string) {
            case "???":
            case "???":
                return 1;
            case "???":
            case "???":
                return 2;
            case "???":
            case "???":
                return 3;
            case "???":
            case "???":
                return 4;
            case "???":
            case "???":
                return 5;
            case "???":
            case "???":
                return 6;
            case "???":
            case "???":
                return 7;
            case "???":
            case "???":
                return 8;
            case "???":
            case "???":
                return 9;
        }
        throw new ShogitterCoreException("Not a Number: string");
    }

    /*
    getRuleHTML(){
        ret="";
        foreach(array_merge(this.ban.strategy, this.mochigoma.strategy) as strategy){
            val=strategy.toHTML();
            if(val!==null)ret.="<li>".strategy.getStrategyGenre().": ".val;
        }
        return ret;
    }

     */
}

/*
class BulkShogi extends Shogi{
    move(from: XY, to: XY, nari){
    fromDirection=this.ban.get(from).direction;
    this.teban.ensureDirection(fromDirection);

    //??????????????????
    this.lastBan=this.ban.getArray();
    this.lastMochigoma=this.mochigoma.getArray();

    //?????????postfix???????????????
    record=array(
        'mark'=>this.teban.getNowMark(),
    'name'=>this.ban.get(from).getShortName(),
    'postfix'=>this.ban.makePostfix(from, to),
);

    //??????????????????
    fromPick=this.ban.take(from);

    //????????????????????????????????????????????????
    captured=this.ban.strategy['Capture'].execute(to, fromDirection);

    //??????????????????
    this.ban.set(to, fromPick);

    record['naripostfix']=this.ban.strategy['Promotion'].execute(to, from, captured, nari);

    lastXY=this.kifu.getXYByTesuu(this.kifu.getTesuu()-1);
    this.kifu.add(
        this.makeKifu(to, from),
    record['mark'].(lastXY['to'].equals(to)?"???":to.getFormat()).record['name'].record['postfix'].record['naripostfix'],
    array('hash'=>true, 'moving'=>this.moving?true:false)
);
    if(!this.moving){
    this.teban.rotate();
}
this.gameEndFinalize();
}
move2(to: XY, species, direction){
    //??????????????????
    this.lastBan=this.ban.getArray();
    this.lastMochigoma=this.mochigoma.getArray();

    kifu2=this.makePutKifuString(to, species);

    this.mochigoma.strategy['MochigomaIO'].executeOut(species, direction);
    this.ban.ensureNotExists(to);
    this.ban.setAdd(to, species, direction);

    this.ban.strategy['Promotion'].executeLegal(to);

    this.kifu.add(
        this.makeKifu(to, null),
        kifu2,
        array('hash'=>true)
);

    this.teban.rotate();
    this.gameEndFinalize();
}
constructByKakinoki2Format(data, nocheckoute=false){
    array=explode("\n", data);
    ruleid=0;
    constructed=false;
    foreach(array as line){
        //			print linecnt++.line;
        line=rtrim(line);
        if(line=="") continue;
        if(mb_substr(line,0,1)=="*"){
            //???????????????
            tesuu=constructed?this.kifu.getTesuu():0;
            comment=mb_substr(line,1);
            comments[tesuu]=comments[tesuu]!=null?"{comments[tesuu]}\n{comment}":comment;
            continue;
        }
        if(mb_substr(line,0,1)=="#") continue;
        if(preg_match("/^(.*)???(.*)/u", line, matches)){
            switch(matches[1]){
                case "????????????":
                case "????????????":
                    matches[2]=new MongoDate(strtotime(matches[2]));
                    break;
            }
            info[matches[1]]=matches[2];
            continue;
        }else if(preg_match_all("/([??????])(([???-???])([???????????????????????????])|???????)(????.)([??????]?)([???????????????]?)(??????|[??????]?)/u", line, matches)){
            if(!constructed){
                constructed=true;
                if(DEBUG_ECHO_TIME) time=getmicrotime();
                this.constructById(ruleid);
                this.start();
                if(nocheckoute){
                    this.rule['strategy']['Judge']['Oute']['ignore']=true;
                }
                if(DEBUG_ECHO_TIME) echo "construct: ".(getmicrotime()-time)."<br>";
            }
            foreach(matches[0] as key => value){
                if(DEBUG_ECHO_TIME) time=getmicrotime();
                //				try{
                //			echo "(", matches[1][key], matches[3][key], matches[4][key], matches[5][key], matches[6][key], matches[7][key], matches[8][key], ")";
                this.moveByKifu(matches[1][key], matches[3][key], matches[4][key], matches[5][key], matches[6][key], matches[7][key], matches[8][key]);

                //				}catch(Exception e){
                //					die("<pre>??????".e.getMessage().e.getTraceAsString().this.getFormat());
                //				}
                //kifu[this.kifu.getTesuu()]=this.getEncodedFormat();
                //	kifu2[this.kifu.getTesuu()]=this.getEncodedFormat2();

                if(DEBUG_ECHO_TIME) echo "move({matches[0][key]}): ".(getmicrotime()-time)."<br>";
                count++;
            }
        }else if(preg_match("/??????(\d+)??????(([????????????]???)(???)(??????)???????|?????????|?????????|??????)/u", line, matches)){
            info['??????']=matches[1];
            info['??????']=matches[4]?matches[2]:matches[3];
            if(matches[5]) info['??????']=true;
        }else{
            throw new Exception("??????????????????????????????: ".line);
        }
    }
//		echo "<pre>".this.getFormat();
//		echo "<textarea>".this.getJSONFormat()."</textarea>";
    obj[0]=array('comment'=>comments[0]);
    foreach(this.kifu.arrayKifu as tesuu => kifu){
        newkifu = array('direction'=>kifu['move'][0],
            'to'=>array(kifu['move'][1][0], kifu['move'][1][1]),
            'koma'=>this.getKomaSpecies(kifu['move'][1][3][1]));
        if(kifu['move'][1][2][1])newkifu['pick']=this.getKomaSpecies(kifu['move'][1][2][1]);
        if(kifu['move'][1][3][1]!=kifu['move'][2][2][1])newkifu['nari']=true;
        if(count(kifu['move'][2])==4){
            newkifu['from']=array(kifu['move'][2][0], kifu['move'][2][1]);
        }else{

        }
        //		print_r(newkifu);
        obj[tesuu+1]=array('move'=>newkifu);
        if(comments[tesuu+1])obj[tesuu+1]['comment']=comments[tesuu+1];
        //		echo "<br>";
    }
    //	print_r(info);
    //print_r(comments);
    return array('header'=>info, 'kifu'=>obj, 'rule'=>"hirate.rule.json");
    /*print_r(kifu);
    print_r(kifu2);
    print_r(kifu3);*BOGUSBOGUS/
}
getHash(){
    return null;
}
static getKomaSpecies(str){
    if(!str) return null;
    hoge = array("aa"=>0,
        "ab"=>1,
        "ac"=>2,
        "ad"=>3,
        "ae"=>4,
        "af"=>5,
        "ag"=>6,
        "ah"=>7,
        "ai"=>8,
        "aj"=>9,
        "ak"=>10,
        "al"=>11,
        "am"=>12,
        "an"=>13,);
    return hoge[str];
}
}

 */
