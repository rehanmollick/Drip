/**
 * The words a reader already has.
 *
 * The corpus supplies the domain dictionary — every unusual word the source
 * leans on. This list is the other half of that subtraction: it is what
 * separates "autolyse" (jargon that needs introducing before it is used) from
 * "dough" (a word everyone walked in with). Without it, a fermentation source
 * looks like it is drowning the reader in vocabulary when half of it is just
 * english.
 *
 * Membership test: would a curious outsider with no interest in this subject
 * already know it? If yes it belongs here, however concrete it is. Nothing here
 * is subject-specific — "cache", "gluten", "mitochondria" and "amortisation"
 * are all words a card has to earn, and none of them appear below.
 *
 * Read by lib/generation/quality.ts. Pure data, no behaviour.
 */
const GROUPS = [
  // the glue of english — carries no meaning of its own
  `a about above across after again against all almost alone along already also although always am among an and
   another any anybody anyone anything anyway anywhere are around as at away back be became because been before
   began behind being below beneath beside besides best better between beyond both but by came can cannot could
   did do does doing done down during each either else enough even ever every everybody everyone everything
   everywhere except far few for from further get got had has have having he her here hers herself him himself
   his how however i if in inside instead into is it its itself just last later least less like little long many
   may maybe me might mine more most much must my myself near neither never next no nobody none nor not nothing
   now of off often on once one only onto or other others otherwise ought our ours ourselves out outside over own
   past per perhaps rather really same seem several shall she should since so some somebody someone something
   sometimes somewhere soon still such than that the their theirs them themselves then there these they this
   those though through throughout thus till to together too toward towards under until up upon us usually very
   via was way we well were what whatever when whenever where whether which while who whole whom whose why will
   with within without would yes yet you your yours yourself`,

  // verbs everyone has
  `accept add admit affect agree allow answer appear apply argue arrive ask attack avoid base beat become begin
   believe belong break bring build burn buy call carry catch cause change check choose claim clean clear climb
   close collect come compare complete consider contain continue control cook copy correct cost count cover
   create cross cry cut deal decide deliver depend describe design destroy develop die divide draw dream dress
   drink drive drop dry eat end enjoy enter examine exist expect explain fail fall feed feel fight fill find
   finish fit fix fly fold follow forget form freeze gather give go grow guess handle happen hate hear
   help hide hit hold hope hurt imagine improve include increase indicate introduce invite join jump keep kick
   kill know laugh lay lead learn leave lend let lie lift listen live look lose love make manage mark match
   matter mean measure meet mention miss mix move name need notice offer open order pass pay pick place
   play point pour practice prefer prepare present press prevent produce promise protect prove pull push put
   raise reach read receive reduce refuse remain remember remove repeat replace reply request rest
   return ride ring rise roll run save say search see seek sell send serve set settle shake share shoot shout
   show shut sing sit sleep slide smell smile sound speak spend split spread stand start stay steal stick
   stop store study suggest supply support suppose surprise take talk teach tear tell thank think throw tie
   touch train travel treat try turn understand use visit wait wake walk want warn wash watch wear win wish
   wonder work worry write`,

  // adjectives and adverbs everyone has
  `able active actual afraid alive angry available aware awful bad basic beautiful big black blue bright broad
   busy calm careful certain cheap clever cold comfortable common cool crazy cruel dangerous dark dead deep
   different difficult direct dirty double dull early easy empty entire equal exact excellent expensive extra
   fair false familiar famous fast fat final fine flat foreign former free fresh friendly full funny general
   gentle giant glad global golden good grand great green grey guilty happy hard heavy high honest hot huge
   hungry ideal important impossible internal international kind large late lazy legal light likely local lonely
   loose loud low lucky mad main major married massive mental middle mild minor modern narrow nasty national
   natural nervous new nice normal obvious odd official old ordinary original outer overall pale particular
   perfect personal physical plain pleasant political poor popular positive possible powerful practical pretty
   previous primary private probable proper proud public pure quick quiet rapid rare raw ready real recent red
   regular relative remote responsible rich right rough round royal sad safe secret secure senior separate
   serious severe sharp short shy sick significant silent silly similar simple single slight slim slow small
   smart smooth social soft solid sorry sour special specific stable steady steep stiff straight strange strict
   strong stupid successful sudden sufficient suitable sweet tall terrible thick thin tight tiny tired top total
   tough traditional true typical ugly unusual upper urgent useful usual valuable various vast warm weak wealthy
   weird wet white wide wild willing wise wonderful wooden wrong yellow young`,

  // people and bodies
  `age arm baby body bone boy brain breath brother child children class country couple daughter doctor ear
   expert eye face family father finger foot friend girl guy hair hand head heart human husband kid knee lady
   leg lip man men mind mother mouth neck neighbour nose parent partner people person player queen shoulder
   sister skin son stomach student teacher teeth throat thumb tongue tooth voice wife woman women worker`,

  // things in a house, on a street, in a hand
  `bag ball basket bath bed bell belt bike blanket board boat book boot bottle bowl box brush bucket building
   button camera candle car card carpet chair clock cloth coat computer cup curtain desk device dish door drawer
   engine envelope fan fence floor fork frame furniture game garage garden gate glass glove hammer hat hole home
   hook house jacket jar key kitchen knife ladder lamp letter lid lock machine map mat mirror money nail needle
   net note notebook oven package page paint pan paper pen pencil phone photo picture pillow pipe plate pocket
   pot radio rail road roof room rope rug ruler screen seat sheet shelf shirt shoe shop sign sink soap sofa
   spoon stair stamp stone stove string suit table tape television tent thread ticket tool toy tray truck tube
   umbrella vase wall wallet wheel window wire yard`,

  // food and the kitchen — concrete, and still not jargon
  `apple bacon banana bean beef beer berry bread breakfast butter cake candy carrot cheese chicken chocolate
   coffee cookie corn cream dessert dinner dough egg fish flour food fruit garlic grain grape honey juice lemon
   lettuce lunch meal meat milk mushroom noodle nut oil onion orange pasta pepper pie pizza potato recipe rice
   salad salt sandwich sauce seed snack soup spice sugar tea toast tomato vegetable vinegar water wheat wine
   yeast`,

  // outdoors, weather, the calendar
  `afternoon air animal autumn beach bird bug cat cloud coast cow day desert dog dust earth evening farm field
   fire flower fog forest frost grass ground hill hour ice insect island lake land leaf lightning minute month
   moon morning mountain mouse mud night ocean plant rain river rock sand sea season shade sky snow soil spring
   star storm stream summer sun sunlight thunder time today tomorrow tree valley wave weather week weekend wind
   winter wood world year yesterday`,

  // the everyday abstractions — the words explanations are built out of
  `accident account action activity advice amount area art attention balance beginning benefit bit bottom
   business case centre chance choice city colour color community company condition contact content course
   crowd culture damage danger decision degree depth detail difference direction distance duty edge effect
   effort energy example experience fact factor feature feeling force future gap goal government group growth
   guide habit half health heat height history idea image impact industry information interest issue job journey
   knowledge language law length level life limit line list loss luck market mass meaning meeting member memory
   message method mistake moment motion music nature news number office opinion option pain pair part path
   pattern pause peace period piece plan police policy position power price problem process product program
   progress project purpose quality quantity question rate reason record region relationship report research
   result reward rhythm risk role rule safety scale scene school science score sense series service shape side
   signal silence situation size skill source space speed sport spot staff stage standard state step story
   strength stress structure style subject success surface system target task team temperature term theory
   thought threat topic trade traffic training trip trouble truth type unit value variety version view volume
   war warning wealth weight width word writing worth`,

  // counting, and the units a person measures a day in
  `two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty hundred thousand million
   billion first second third quarter triple percent dozen inch mile metre meter kilo gram pound litre liter
   gallon`,

  // the phone in their pocket: everyday computing, not engineering
  `app email file folder internet link online password site software user video web website click download
   upload`,
] as const;

/** Every word above, deduped. Lowercase, no punctuation — callers lowercase before testing. */
export const COMMON_WORDS: ReadonlySet<string> = new Set(GROUPS.join(" ").split(/\s+/).filter(Boolean));
