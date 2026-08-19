jul 8, 2026
Revisión consolidado EETT
Invitado fabian.mendez@webcarga.com Felipe Soto
Archivos adjuntos Revisión consolidado EETT
Registros de la reunión Transcripción 


Resumen
Discusión sobre diseño de interfaces operativas, optimización de automatización y estandarización de archivos para mejorar la eficiencia.

Diseño de interfaces operativas
Se definió la estructura del módulo de transporte con filtros para equipos activos. Se identificó la necesidad de ser estrictos en la redacción de instrucciones de automatización.

Estandarización de archivos maestros
La disparidad en formatos de archivo se resolvió mediante la implementación de una base de datos maestra. Esta consolidación permite eliminar el retrabajo entre los colaboradores.

Configuración independiente de seguros
Se decidió establecer la gestión de seguros como un módulo independiente dentro de la plataforma. Esta separación técnica busca evitar la sobrecarga cognitiva del usuario final.


Próximos pasos
[Felipe Soto] Integrar modulo: Conectar la plataforma a la base de datos centralizada con la estructura acordada para permitir el despliegue del módulo de empresas de transporte.
[fabian mendez ramos] Actualizar datos: Incorporar la información de seguros al archivo consolidado e incluir las fórmulas necesarias para calcular automáticamente los porcentajes de cumplimiento documental.
[fabian mendez ramos] Compartir enlace: Enviar nuevamente el vínculo del Sharepoint con la estructura de archivos actualizada para que Felipe Soto pueda proceder con la integración.
[fabian mendez ramos] Validar ejecucion: Coordinar con Pablo la revisión del proceso de carga mediante el prompt para asegurar que el sistema se limite a los parámetros de búsqueda de clientes activos.


Detalles
Problemas técnicos con equipos de computación: Felipe Soto y fabian mendez ramos discuten las dificultades técnicas recurrentes con sus computadoras, las cuales presentan lentitud y congelamientos al mantenerlas en modo de suspensión, por lo que han adoptado la rutina de apagarlas diariamente para mitigar estos fallos (00:02:25).
Diseño y lógica de la interfaz para transporte: Se analiza la propuesta para la interfaz del módulo de empresas de transporte destinada a Pablo y al equipo de operaciones, buscando una visualización clara y funcional que permita identificar rápidamente los equipos asignados versus los pendientes (00:03:37). Se acuerda implementar filtros que faciliten la gestión manual y mejoren la eficiencia al momento de visualizar el estado de la operación (00:04:59).
Situación personal familiar: Durante la conversación, Felipe Soto comenta brevemente sobre una situación familiar relacionada con el financiamiento para la compra de un medicamento de alto costo, mencionando la realización de una rifa como solución (00:07:48).
Desafíos con la automatización de procesos: Se identifica que el asistente de inteligencia artificial no está procesando correctamente las instrucciones de búsqueda en SharePoint, accediendo a carpetas de empresas no activas o subcarpetas no solicitadas en lugar de ceñirse a los parámetros de empresas activas (00:10:58) (00:18:39). Felipe Soto y fabian mendez ramos acuerdan que es necesario ser extremadamente específicos y estrictos en la redacción del prompt para asegurar que solo se prioricen las carpetas de clientes activos y aquellas que contengan la palabra "transporte" (00:14:51) (00:19:59).
Consolidación y estandarización de archivos: Se discuten las dificultades para integrar la información debido a la disparidad en los formatos de los archivos Excel que manejan los distintos colaboradores, como Karen, Vicente y María Eugenia, quienes no siguen un formato único (00:23:06). Se establece como solución utilizar la base de datos compartida por Felipe Soto como estructura maestra y realizar un cruce con la información iterada por fabian mendez ramos, evitando así el retrabajo y asegurando la integridad de los datos (00:24:48).
Estructura del módulo de empresas de transporte: Se define que la vista del módulo incluirá columnas diferenciadas para tractores y ramplas, lo cual permitirá al equipo de operaciones identificar el tipo de equipo disponible de manera inmediata (00:27:24). Asimismo, se acuerda integrar filtros de estado ("activo" y "no activo") para priorizar la carga de trabajo y asegurar que las operaciones se centren en los casos urgentes (00:28:46).
Cálculo de cumplimiento de documentación: Se propone implementar fórmulas dentro del archivo Excel para medir automáticamente el porcentaje de avance en la documentación de cada empresa (00:31:34). fabian mendez ramos sugiere que este cálculo permita que la aplicación genere alertas cuando el cumplimiento sea inferior al 90%, proporcionando a operaciones información clara para la asignación de equipos (00:33:08).
Gestión de seguros como módulo independiente: Felipe Soto propone que la sección de seguros se configure como un módulo independiente dentro de la plataforma para evitar la sobrecarga cognitiva del usuario, asegurando que, aunque la información de seguros esté vinculada a cada empresa, su gestión se realice en un espacio separado, ordenado y específico (00:35:51).
Próximos pasos y cierre de la integración: Se acuerda que fabian mendez ramos actualizará el archivo base con la información de seguros y el consolidado de empresas para el día siguiente, momento en el cual Felipe Soto procederá con la integración técnica en el front-end para concluir con esta fase del desarrollo (00:38:35).


jul 8, 2026
Revisión consolidado EETT - Transcripción
00:02:25

Felipe Soto: Hola, Fabi, ¿cómo vas?
fabian mendez ramos: Bienvenito,
Felipe Soto: Bien. Bien, todo bien.
fabian mendez ramos: P.
Felipe Soto: Oh, me cansé. Hón, corriendo, poniéndole, poniéndole. ¿Cómo va la semana?
fabian mendez ramos: Iba a empezar ahora. Vamos empezar.
Felipe Soto: Iba pesada y ahora va más pesada. ¿Me escucháis bien? ¿Cierto?
fabian mendez ramos: Sí, cortado.
Felipe Soto: Yeah.
fabian mendez ramos: El audio no se te ha cortado el
Felipe Soto: ¿Cómo? Sí, ha andado raro.
fabian mendez ramos: audio.
Felipe Soto: Se me queda pegado la pantalla. Mi computador anda como friseado y eso que lo he apagado todos los días.
fabian mendez ramos: Ya me acostumbré ahora los viernes a pagar el computador por lo menos antes también por lo dejaba en suspensión putos como un
Felipe Soto: De hecho, a mí me pasaba otra cosa cuando estaba en Falabela,
fabian mendez ramos: mes.
Felipe Soto: que era tan viejo y tan malo el computador que no lo apagaba, porque si lo apagaba iba a ser
fabian mendez ramos: Ah, sí,
Felipe Soto: peor.
fabian mendez ramos: pues si eso me pasaba con computador antiguo que al apagarlo se mora caleta en iniciar.


00:03:37

fabian mendez ramos: Entonces, por eso me acostumbré siempre a dejarlo en suspensión.
Felipe Soto: ía que
fabian mendez ramos: Pero después el otro problema de suspensión es que como siempre anda optando actualizaciones te crea carpeta
Felipe Soto: no
fabian mendez ramos: penca que ralentiza el
Felipe Soto: eh y no lo apagaba porque tenía que no sé presentar algo,
fabian mendez ramos: la
Felipe Soto: una hacer una presentación, sacar unos datos y era como, hón, si lo apago estoy c*****, no voy a llegar, pero le va a hacer cariño a mi computadora. Así tranquilo, tranquilo.
fabian mendez ramos: atención.
Felipe Soto: Así hace tuto guagua. Oye, em, cuéntame, cuéntame primero cómo cómo te fue con con la app, aparte del error 500, que no lo no lo he corregido aún. E me gustaría que revisáramos eh la cómo debería ser con la interfaz de la empresa de transporte. Imagínatelo así como muy muy visual. Veamos esa lógica. e para que sea lo más optimizado y útil para con Pablo, conociendo cómo piensa
fabian mendez ramos: Mira, o sea, no vi otra lógica que me parecera rara.
Felipe Soto: Pablo.
fabian mendez ramos: Es que en realidad para mí en sí como está la plataforma me funciona para verlo yo, que lo logro visualizar en realidad siempre.


00:04:59

fabian mendez ramos: Por eso después te puse si es que, ¿cómo se llama?
Felipe Soto: Hm.
fabian mendez ramos: que lo vea Pablo que le ve otra cosa y que también lo vea operaciones, ya que ellos den como el detalle más visual de si se le hacen cambio más pequeño,
Felipe Soto: Hm.
fabian mendez ramos: cosas así como que lo vean diferente, porque obviamente el cambio para ellos va a ser drástico en el sentido que van a dejar de ver las plataformas normales con el van a tener que ver todo acá.
Felipe Soto: A ver, en en cuanto a lo que es como el monitor de viajes donde están las tablas o así como tipo Canvan, para mí creo que hemos como resuelto buena parte lo que nos estaba pidiendo Pablo.
fabian mendez ramos: Incluso los filtros que tú tení son interesantes porque los podí al apretarlo solamente ya te va tirando directo.
Felipe Soto: Sí. Yeah. Esa era la
fabian mendez ramos: Entonces igual funciona bien.
Felipe Soto: idea.
fabian mendez ramos: Y lo que te decía, por ejemplo, también después para los que van a quedar pendientes, e ese menú que tenéis desplegable al costado también es bueno porque va a ser rápido,
Felipe Soto: Ajá.
fabian mendez ramos: se como los chiquillos. Ya, mira, tengo casi lo mismo que estoy viendo como coanalitic, tengo 10 equipos asignado cuando se metió a la operación y ellos saben que en


00:06:25

Felipe Soto: Mhm. Mhm.
fabian mendez ramos: su visión de operaciones tienen que mover 25 equipos. Entonces, si ellos ven, dicen, "Ah, tengo, mira, tengo 10 equipos moviendo, me faltan 15. En esta ventanita que yo tengo de flagable, tengo 15 o tengo más."
Felipe Soto: Sí,
fabian mendez ramos: Esa va a ser como la lógica que ellos van a tener que empezar a ver.
Felipe Soto: sí, como que vaya a poder ver rápido a quién llamar y a quién no llamar.
fabian mendez ramos: Exacto.
Felipe Soto: Sí,
fabian mendez ramos: Les vaya a quitar pega a ellos de de cómo llamamos,
Felipe Soto: se
fabian mendez ramos: de solo ver a los pendientes, pero más rápido, de no hacer esa pega manual que hacían. Y ahora todos los viajes que tengo enaltis los voy agregando manual al diario y ahí recién veo lo que tengo pendiente.
Felipe Soto: perfecto. Yo creo que en ese sentido estamos alineados. E ahora mi pregunta también va por el lado, voy a compartir pantalla que quiero que antes de tocar el el código y conectar como la primera versión que tenís, porque no sé, me pasa como que quiero y no quiero hacer la integración aún mientras no tengas como centralizado toda la empresa de transporte o las que acordaron con Pablo que hay que centralizar para poder conectarlo, para no hacer retrabajo.


00:07:48

Felipe Soto: Dame un segundo.
fabian mendez ramos: Dale. Yeah.
Felipe Soto: Ya, sorry. Estoy con con mi mamá que se tiene que comprar un remedio y est haciendo unas preguntas sobre el rem que mamá se tiene que comprar un remedio más o menos carito.
fabian mendez ramos: ¿Cómo? ¿Cómo?
Felipe Soto: En realidad es caroón y viendo cómo cómo financiarlo y estamos resolviendo
fabian mendez ramos: Ah,
Felipe Soto: esa eh estamos haciendo una
fabian mendez ramos: no tiene cómo verlo como con el con alguna así.
Felipe Soto: rifa. Ya te lo voy a mandar.
fabian mendez ramos: mándalo.
Felipe Soto: Te lo voy a mandar. En una de esas te ganáis un cordero. ¿Te gusta el cordero? Está faneado.
fabian mendez ramos: Dale.
Felipe Soto: Quiero dame 10.
fabian mendez ramos: Me me un
Felipe Soto: Dame 10.
fabian mendez ramos: cordero.
Felipe Soto: Rato. E ya. Pues entonces estoy compartiendo pantalla. Sí,
fabian mendez ramos: Sí, te está compartiendo.
Felipe Soto: estoy compartiendo ya aquí lo que lo que quería que revisáramos antes de hacer el el como esa integración que te decía, porque quiero que tengamos bien redondito eso y validado, eh, por lo menos la estructura,


00:10:58

fabian mendez ramos: Ah.
Felipe Soto: no importa si son no importa que tengas centralizadas todas las organizaciones, pero por lo menos unos tantas carpetas para ver si lo está haciendo bien, ¿cachá? Y en base, suponte, ¿no? Ya de todos los archivos, carpetas que procese, digamos, cinco carpetas, por decir algo, eh, ya estoy como estable lo que estás corriendo como en el prom. Lo conectamos y de ahí podéis procesar todo lo demás porque eso me asegura de que lo que me estáis pasando para poder conectarlo viene con la estructura que corresponde para yo hacer el procesamiento, ¿me cacháis?
fabian mendez ramos: Ya. Sí.
Felipe Soto: Eh, para no estar después editando acá más de una vez o muchas veces. eh el script como nos pasó con Win Suite y fue así, ¿cachá? para no hacer tanta interacción en ese sentido. Entonces, lo que quiero que veamos ahora en parte podría ser que bueno, es que Pablo El que corre la huevadaón. Pablo, el que te ejecuta el pronto. No eres tú.
fabian mendez ramos: Es que lo como él tiene el pagado funciona.
Felipe Soto: Ya.
fabian mendez ramos: Ahí me quedó una duda, pero voy a tener que juntarme con Pablo para verlo cómo corre el pronto.
Felipe Soto: Ya.


00:12:17

Felipe Soto: ¿Qué es?
fabian mendez ramos: Yo le mandé el enlace de la carpeta de Charpint de la que yo saco de me imagino que debería ser igual para el
Felipe Soto: Ya.
fabian mendez ramos: PHP.
Felipe Soto: ¿Cómo así?
fabian mendez ramos: porque le mandé el enlace como yo que saqué del checkpoint normal como de web carga.
Felipe Soto: Ya.
fabian mendez ramos: Entonces me imagino que para Pablo como es un enlace debería ser igual,
Felipe Soto: Sí.
fabian mendez ramos: pero el problema que Pablo tiene conectado el como el webcarga como el Pablocarga y el Pablo@gmail que parece que funcionan diferente, pero están puestos ahí.
Felipe Soto: Mientras el el el cloud lo conectes al al Office o a la conexión, sí, la conexión de OneDrive, independiente si se conecta con el web carga o no, va a poder entrar.
fabian mendez ramos: No, sí, pues si se supone que entró.
Felipe Soto: Sí.
fabian mendez ramos: Lo que me pasó es que yo solamente le mandé la carpeta de la empresa
Felipe Soto: Ya,
fabian mendez ramos: activa, de los clientes activos,
Felipe Soto: ya,
fabian mendez ramos: pero de Walmart.
Felipe Soto: ya.
fabian mendez ramos: Y el hón se metió el como no sé cómo lo hizo, pero la carpeta me tiró empresas de Sodimac no activo. Como que no le importó mucho el enlace.


00:13:43

Felipe Soto: Ah. Ah. Como que no sé, no. El el huevón fue subversivo y no siguió los
fabian mendez ramos: Sí, pues, o sea,
Felipe Soto: parámetros.
fabian mendez ramos: le dije así como, "Ya, métete a los transportes, pero de este enlace que tiene subcarpetas que dice transporte y que dicen el Excel debería decir status." Y se lo mandé solamente para las empresas que estaban activas para que me buscara solo tracto activo, no como general,
Felipe Soto: Ya,
fabian mendez ramos: no como la carpeta general de webcarga, así como están todos los transportes.
Felipe Soto: ya.
fabian mendez ramos: Se lo fui le acoté como el enlace. A ver cómo lo hacía.
Felipe Soto: Mm.
fabian mendez ramos: Al final igual se el hón se metió en todas las carpetas porque después me puso la operación y me puso sodigma, me puso tracto. Entonces, si lo hizo así,
Felipe Soto: H
fabian mendez ramos: no sé si fue porque Pablo mandó el mensaje de mandó como ese pron en el mismo mensaje que tenía había puesto la cuestión de los seguros.
Felipe Soto: puede que se haya mareado.
fabian mendez ramos: y mantuvo como la información entre con los seguros con esta nueva y no lo metió en un chat nuevo.


00:14:51

Felipe Soto: Sí, sí. Sí, pu puede ser puede ser, sí. Pues es muy probable.
fabian mendez ramos: Porque al final igual me puso como una columna operación y me puso la operación,
Felipe Soto: Bueno,
fabian mendez ramos: entonces sé que se metió a esas carpetas.
Felipe Soto: sí, sí. Yo creo que tenía que haber partido de ser hón. Hay que validar eso.
fabian mendez ramos: Pero igual me sirve porque en realidad sí por lo que pusimos en el Chrom me busca la información, lo separa como lo que queríamos.
Felipe Soto: En la estructura que queríamos. Sí, si lo vi el archivo.
fabian mendez ramos: Sí. Entonces,
Felipe Soto: Sí.
fabian mendez ramos: por lo menos yo ya digo, ya preliminarmente el PROM funciona.
Felipe Soto: Mm.
fabian mendez ramos: Le dijo a Pablo igual como algunos errores y le hizo como unas preguntas así como sigo por este lado, ¿qué opción querí? y le di como tres ofertas. Pero en sí el formato, es lo que quería yo, porque dije, para qué que me cree como una ventana con todo y me la separo por empresa,
Felipe Soto: Yeah.
fabian mendez ramos: conductor, equipo, está bien. Y por lo menos veo que la información igual está bien. Mantuvo la fecha.


00:16:04

Felipe Soto: Okay. Ahí, ahí. Yo creo que habría que validarlo con Pablo hoy y que podamos tener esa información mañana. Hón, es posible.
fabian mendez ramos: V a tener todo, ¿no? que yo estaba pensando cargarlo así no más, cargar esta ino así y lo demás dejarlo como en blanco.
Felipe Soto: Ahí entra, pero ahí estáis seguro que esa esas empresas y con lo que me estáis diciendo de que puede que se haya mariado sean empresas activas.
fabian mendez ramos: que por ejemplo yo del enlace no le mandé, por ejemplo, tengo la primera empresa que me sale en el archivo, el último que me mandó Pablo, se supone que es como el consolidado completo,
Felipe Soto: ¿Qué me mandaste esto ayer?
fabian mendez ramos: ¿no? Ya te mandé el primero que era el lote uno,
Felipe Soto: Ya. Ah, te mandó otro.
fabian mendez ramos: después mandó otro que yo pensé que era el lote dos,
Felipe Soto: Ya
fabian mendez ramos: pero no. Pues ahí le puso como consolidado, lo generó completo. Mandó como un lote uno así como preliminar,
Felipe Soto: va.
fabian mendez ramos: como visualiza este archivo para ver si que voy bien y sigo con los demás.


00:17:18

Felipe Soto: A ver, muéstrame ese archivo. O sea, la pega está hecha.
fabian mendez ramos: Sí, son lo que me falta pasarle al archivo general que lo voy a hacer mañana porque ahora con la red que te dije que me puso Pablo en la mañana la terminé hace poco,
Felipe Soto: Mi madre.
fabian mendez ramos: así que ni siquiera he avanzado en nada que empezar a avanzar con de
Felipe Soto: Hón,
fabian mendez ramos: pago. Ya tú viste hasta acá la columna 11.
Felipe Soto: sí, sí.
fabian mendez ramos: Entonces yo como por mi memoria mete la empresa de
Felipe Soto: Hm.
fabian mendez ramos: transporte. Entonces, por ejemplo, yo sé que esta son empresas activas y está bien,
Felipe Soto: Ya,
fabian mendez ramos: pues que me dice que está en Walmart Tact. Aquí me puso la carpeta,
Felipe Soto: eso está bueno.
fabian mendez ramos: pero ya acá me dice que es Sodimar. Yo sé que por ejemplo que transporte mirando de Sodiar, yo no le di el enlace de que se metiera SOD,
Felipe Soto: Ah, ya ya
fabian mendez ramos: yo le di este enlace,
Felipe Soto: ya
fabian mendez ramos: el de Walmart Tracto, empresa activa, que lo tengo acá abierto. Este viste que dice operación Walmart,


00:18:39

Felipe Soto: sí.
fabian mendez ramos: documento reclutamiento, me metí operación Walmart activo y el hón se metió acá, se metió Sodió Totu y aparte de una operación Walmart, yo me metí a tractos. documento se metió aquí a furgones,
Felipe Soto: y te le dio todas las
fabian mendez ramos: no sé si todas las carpetas,
Felipe Soto: carpetas.
fabian mendez ramos: pero leyó empresa transporte así no me leyó todo, ¿viste? Aquí yo no activo.
Felipe Soto: Sí.
fabian mendez ramos: Tengo tengo 21 y el hón no me leyó 21, pues me leyó más 29 porque me leyó incluso hasta el no activo que aquí me pone transporte maquin no
Felipe Soto: Yeah.
fabian mendez ramos: activo. No me leyó los activos los de acá. Me leyó los de acá. De aquí tengo más.
Felipe Soto: O sea, en realidad te leyó un poco de de
fabian mendez ramos: Sí, o sea,
Felipe Soto: todo.
fabian mendez ramos: yo le mandé este enlace de acá para que se metiera sola la carpeta de cliente activo. Hón, me leyó clientes no activos,
Felipe Soto: Ya.
fabian mendez ramos: me leyó, se fue para atrás, se metió Sod, se metió Totu y ahí empezó a leer.


00:19:59

Felipe Soto: Mm. Ya. O sea, lo que tú lo que tú me estáis diciendo es que el promp está funcionando, pero no está consolidando todo. Como que se mete un está haciendo como un muestreo de la de cada
fabian mendez ramos: Sí, sí.
Felipe Soto: carpeta.
fabian mendez ramos: Pues lo raro es que ahí me pareció raro porque quizás con la palabra transporte, pero tampoco los leyó todos porque a todos le puse, por ejemplo, prioriza las carpetas que dicen transporte. Si hubiera sido así, me hubiera leído todos los que están aquí no activos. Igual tengo varios que dicen transporte y no están todos.
Felipe Soto: Entonces, en ese sentido, para que no se maree tanto o haga un muestreo, debería ser como le las todas las carpetas que están dentro de clientes no activos. y clientes activos todo. Así como estrictamente léeme todos los archivos que están en las subcarpetas de esas dos carpetas que que estoy diciendo.
fabian mendez ramos: S algo así voy a tener que para decirle para decir
Felipe Soto: como es como ampliar la búsqueda,
fabian mendez ramos: que
Felipe Soto: pero siendo muy específico y estricto en el
fabian mendez ramos: sí, o sea, es como decirle, "Mira, te voy a mandar dar este enlace,
Felipe Soto: requerimiento.
fabian mendez ramos: pero solo ingresa las carpetas clientes activos, clientes no activos y priorízame las que dicen transport, las que no dicen transporte dejala como más abajo como línea, pero prioriza la transporte


00:21:28

Felipe Soto: Y es necesario que priorice las que dicen transporte.
fabian mendez ramos: el que las mayores o prioriza todos los que dicen en el archivo estatus que todos les puse así. Todos parten con estatus. Es le metier
Felipe Soto: Hm.
fabian mendez ramos: ahí.
Felipe Soto: Porque ahí yo no no priorizaría lo que es como activo o no activo, va, no priorizaría lo que fuese transporte o no, eh porque al final igual lo que lo que necesitamos priorizar es si es activo o no activo. M.
fabian mendez ramos: Esa sería la otra opción, pero hasta el momento ya me llenó este y ese este iba a cargar la info al archivo de lo que teníamos como para que Pablo vea como una muestra. En realidad, Pablo, no nos le interesa que lo tengamos completo.
Felipe Soto: Eh, no, pero está bien ahora con lo que tú me estás aclarando, digamos, estamos en condiciones como para hacer la integración.
fabian mendez ramos: Hm.
Felipe Soto: Después a lo que voy es que yo podría crear como los esquemas de datos en la base de
fabian mendez ramos: Yo
Felipe Soto: datos con con estas tablas, digamos, empresa transporte, conductor, equipo con la estructura que ya tenemos acá y armar el modelo para que se pueda conectar en el front. Después se hace un barrido, se se pisa la información con lo que con los casos que corresponden.


00:23:06

fabian mendez ramos: yo me estoy guiando por el archivo que nos mandaste, que ¿Dónde está?
Felipe Soto: Ha. Entonces, me tiráis la pelota a mí para yo hacer la integración. Eso por un lado, por otro lado quedaría como seguir iterando para tener como la información final, pero por lo que ya tenemos podemos hacer modelo de del módulo de empresa transporte para que se conecte con el Ya.
fabian mendez ramos: Ev. Y este lo tengo ya actualizado.
Felipe Soto: La
fabian mendez ramos: Estos los tengo en amarillo, que son los que se supone que se van a salir. No sé si Pablo los va a querer igual. como empresa activa, pero ya
Felipe Soto: Ahí yo tengo una duda porque lo que me estáis mostrando,
fabian mendez ramos: que
Felipe Soto: el otro archivo que procesaste con el con el Claudio e es lo mismo que la base como el que yo les compartí.
fabian mendez ramos: es casi lo mismo, solo que tiene distintos nombres.
Felipe Soto: nombre
fabian mendez ramos: Sí,
Felipe Soto: columna.
fabian mendez ramos: porque es como el lo que pasa es que lo pasa con los chiquillos con la Karen y ahora el Vicente que son los que están en reclutamiento o con los que la Mari Eugenia que de repente recluta. Eh,
Felipe Soto: Ha.


00:24:48

fabian mendez ramos: cuando ingresan una nueva empresa copian el archivo Excel de cualquiera, no tenemos un formato como específico.
Felipe Soto: Ah. Ah.
fabian mendez ramos: Por más que les dijimos que había un formato, igual no lo pescaban y agarraban cualquiera.
Felipe Soto: Teş
fabian mendez ramos: Entonces, tenemos, por ejemplo, eh empresas que en su momento el Excel dice tenía solo una ventana grande que estaba separado por tabla, entonces teníamos la tabla aquí empresa, saltábamos una línea, decía conductores, saltábamos una línea, decía equipo. Y hay otros archivos que tienen lo estaban que son los más antiguos que están separados por ventana y decía empresa, conductores, vehículo y después decía estatus. teníamos las tres ventanas como separados y después le está consolidado a
Felipe Soto: Ah, ya. Entonces,
fabian mendez ramos: todo.
Felipe Soto: entonces en teoría lo que nosotros deberíamos hacer es yo me conecto a este que me estás mostrando, que es la base que les compartí yo, y después con el consolidado que tú vayas a seguir iterando,
fabian mendez ramos: Sí,
Felipe Soto: vaya como anexar los casos que faltan a esto para que después yo me pueda yo pueda
fabian mendez ramos: sí, si la idea.
Felipe Soto: como Ya, perfecto. Si me hace
fabian mendez ramos: Exacto. Y por eso la idea era como no quería mover esto porque al final es como tu tu base


00:25:58

Felipe Soto: sent
fabian mendez ramos: y no moverte esto y nosotros amoldarnos esto con estos nombres que ya tenía acá, no cambiarlo, sino que nosotros hacer como el cruce ya el Pipe tiene el título copia se representante legal, busquemos si es que está el mismo nombre y tiene más letras para el costado. Bueno, es el problema nosotros. Ahí vamos viendo, pero ya está la base y por eso me mantuve acá y por eso te dije lo mismo. Presa transporte está en el nombre. Este nombre debería ser el mismo que el que están arriba en el admin de W cargas.
Felipe Soto: No
fabian mendez ramos: No debería estar modificado como para que te note el cruce
Felipe Soto: entiendo.
fabian mendez ramos: bien.
Felipe Soto: Sí, está perfecto. Ya, entonces me
fabian mendez ramos: Y lo mismo para los conductores y vehículos, igual,
Felipe Soto: conecto
fabian mendez ramos: pero ya está con el de BP, con lo que el ROC con separado. Okay.
Felipe Soto: Ya está bien, está bien. Ya. Entonces voy a conectarme eso con la información que tú tienes ahí y eso lo voy a empezar a hacer mañana y te voy a compartir pantalla. Ah, se ve, ¿cierto? Sí,
fabian mendez ramos: He.


00:27:24

Felipe Soto: se está viendo eh mostrar parte de cualquier modo. Sí. ¿Ya? Entonces, lo que lo que lo que necesito aquí es entender y que también me ayudes como tú como usuario de la plataforma, cómo debería ser la vista de este módulo para que sea lo más intuitivo, porque porque fue básicamente el mismo ejercicio que hicimos con Pablo que
fabian mendez ramos: Tá.
Felipe Soto: no hizo harto challenge, dijo, mira, tiene que tener esto, esto, esto, se tiene que ver de esta manera. Quiero hacer el mismo ejercicio
fabian mendez ramos: Mi idea preliminar como de esa empresa,
Felipe Soto: contigo.
fabian mendez ramos: yo creo que mantenerlo igual como está. Sí, porque dice empresa rot y cuántos conductores y equipos tiene quizás
Felipe Soto: Esto
fabian mendez ramos: pónele conductor extracto y rampla o semiremolte para diferenciar si es que tienen si son furgones o no.
Felipe Soto: tú dices como dos columnas más, como tracto rampla.
fabian mendez ramos: Sí, para que sepan, por ejemplo,
Felipe Soto: Ya.
fabian mendez ramos: si te dice que tiene cero porque para los chiquillos de operaciones va a ser tractoreo y los otros tienen si tiene una rampla es porque es furgón o es otro para otra operación. Quizás para que lo vean así y que tengáis el filtro.


00:28:46

Felipe Soto: Acá.
fabian mendez ramos: Por ejemplo, aquí tenéis que te dice tenéis 242 empresas operacionales que son las que estáis trayendo completas y la idea es que tengáis el filtro que digan activa no
Felipe Soto: Sí.
fabian mendez ramos: activa cuando hagáis el cruce,
Felipe Soto: Ya.
fabian mendez ramos: porque se supone que te lo estáis trayendo del tema dijiste, ¿no es cierto?
Felipe Soto: No.
fabian mendez ramos: Cuando subá el archivo, ahí están todas las empresas activas y todas las que no te hizo el cruce con el bot están no activas. Ese es como el filtro para que los chiquillos sepan que no hay activa, o sea, que hay las que están activas son las que tienen que ellos priorizar y las que le van a hacer el cruce con el
Felipe Soto: Y ahí habría que agregar el otro,
fabian mendez ramos: diario.
Felipe Soto: el como activo y ver próximo a vencer documentación o
fabian mendez ramos: Sí. Y ya después,
Felipe Soto: no.
fabian mendez ramos: pero ahí no sé cómo va a querer verlo, si lo va a querer ver acá en empresa o meterse por empresa,
Felipe Soto: Ok.
fabian mendez ramos: si va a querer eso mismo que tú tenías acá, el cumplimiento está el día y Yeah. salir una alerta como en amarillo, le falta documentación como para que se metan uno por uno o lo otro que es como lo que tiene


00:29:59

Felipe Soto: Ok.
fabian mendez ramos: él en el en la aplicación que estaba viendo antes que tiene como los pasos a paso, no me acuerdo cómo se llama, como lo que estábamos pensando en antes con finanza, ¿viste? que teníamos ya tenemos el diario, tenemos empresa y si que va a querer otro módulo que diga
Felipe Soto: Ya es que para para allá para allá iba en el sentido de que para
fabian mendez ramos: reclutamiento.
Felipe Soto: mí el módulo de empresa transporte es el macromódulo y va va a tener como una sección reclutamiento y otra sección como de operaciones o finanzas, ¿cachá? Entonces,
fabian mendez ramos: Bien.
Felipe Soto: en esa línea no sé a lo sé cómo hacer la visualización, la interfaz para que tenga la menos la menor cantidad, ¿sí? o lo la menor carga cognitiva, digamos, de algún modo para con ustedes de que no sé si me preguntáis a mí, yo veo esta cuestión con con títulos de de la empresa de transporte y encuentro refea la h pero es funcional
fabian mendez ramos: Sí,
Felipe Soto: puón.
fabian mendez ramos: que yo soy lo más, a mí me da lo mismo los colores y la ha que resalte y que se vea bonito. A Pablo le gusta la visualización porque lo ve para los demás. Digo, yo no lo voy a ver, no estoy bien.


00:31:34

Felipe Soto: Cach.
fabian mendez ramos: Que lo vea con operaciones si es que les llama la atención. Pero me pasa que por eso que el reclutamiento es tan amplio que no sé cómo
Felipe Soto: Entonces,
fabian mendez ramos: visualizarlo, que se vea acotado. Quizás Pablo va a querer lo que vimos que están en los archivos que tú lo colocaste al final, que es el avance.
Felipe Soto: avance.
fabian mendez ramos: Recordé que había un avance 8020 que es Pablo que y está la 8020 es para que ingrese y el avance total es porque están tiene toda la documentación. Quizá esa visualización acá dependiendo de lo que se coloque lo vamos a tener que poner.
Felipe Soto: Hm.
fabian mendez ramos: Vamos a tener que no sé si en el archivo Excelo te te lo puedo dejar con fórmula y no te molestaría cargar.
Felipe Soto: ¿Cómo así?
fabian mendez ramos: para que ese porcentaje me lo calcule con los documentos que tengo acá. ¿Viste que Pablo te dijo que este archivo la idea es que cuando tú lo carguís sea que podáis modificar en la app y en el archivo aquí solice los dos?
Felipe Soto: Quiero entenderte, pero quiero que sea más explícito. Creo que estamos entiendo la idea, pero es como que el eh no sé por Acar en Vicente eh suben los archivos y ahí se reporte el avance de los documentos que están cargados,


00:33:08

fabian mendez ramos: Sí,
Felipe Soto: ¿cierto?
fabian mendez ramos: pues la que el de la del archivo que tú te vayas a unir el
Felipe Soto: Sí,
fabian mendez ramos: está cumplimiento,
Felipe Soto: sí, sí,
fabian mendez ramos: lo tenemos solo con datos así como llenado en manual Como es un Excel,
Felipe Soto: sí,
fabian mendez ramos: el archivo no te va a quedar muy pesado si yo le meto una fórmula.
Felipe Soto: no, porque al final yo leo un dato. Va a leer el dato, el cálculo. Entendería que se vería así.
fabian mendez ramos: Ya es como para meterle la forma del cálculo de ese porcentaje, como para que lo vaya tomando dependiendo si los chiquillos le metieron otro dato.
Felipe Soto: Y y tú pensando para para con operaciones y el el el la gestión de las empresas de transporte para saber si también asignados el monitor de
fabian mendez ramos: Sí, pues es para que es para que vean que por ejemplo tú
Felipe Soto: viaje.
fabian mendez ramos: tenías al principio una empresa te dice que está el día, cumplimiento al día.
Felipe Soto: Sí, sí.
fabian mendez ramos: La idea de eso es que pongamos el porcentaje, se visualice el porcentaje que te diga a los chiquillos,
Felipe Soto: Sí.
fabian mendez ramos: ah, mira, por ejemplo, Agrocapilla está el día y él está disponible, está disponible para mover y yo lo tengo que asignar.


00:34:24

fabian mendez ramos: En el caso que me diga bajó el 90 ya y los chiquillos les dé como un aviso así como o lo le salte a ellos la duda. ¿Por qué bajó el porcentaje? ¿Qué documento me falta? ¿Está disponible?
Felipe Soto: Ya con ya para este caso que son como data legacy, por decirlo de algún modo, está bien que me pase el porcentaje para dejarlo eh visualizado acá en en el módulo de empresa de transporte. Perfecto. E en teoría, con lo que ha dicho Pablo, la idea es que se pueda centralizar en en un lado o nos traemos toda la información desde el el OneDrive y la gente de reclutamiento de operaciones si quiera validar algún documento, apriete el link y lo lleve particularmente a donde está ese archivo, ¿cierto? o bien que la plataforma, esta cuestión que estamos haciendo, tenga la opción de empezar a a a centralizar también la documentación, o sea, cargar los archivos y en base a la carga de archivo y si están validad eh ese mismo esa misma fórmula que está diciendo se autocalcule en la aplicación.
fabian mendez ramos: Tam.
Felipe Soto: Ya. Entonces, para este caso, eh, sí, agrega la la la la la información para traerlo y ahí veo si nos da como para que se habilite esa ha de que empiecen a cargar y centralizar la la información acá.


00:35:51

Felipe Soto: Eh, ya con eso yo creo que estamos perfectos. Hón y visualmente,
fabian mendez ramos: porque como fallaba el Yeah.
Felipe Soto: Bueno,
fabian mendez ramos: Me imagino de reglamento PL,
Felipe Soto: sí,
fabian mendez ramos: o sea, para que lo visualicen en general, porque en si eso es lo que quieren ver,
Felipe Soto: pues
fabian mendez ramos: que le tire la alerta. Lo principal para operación es que cuando reclutamiento como ve el tema de los seguros, los buenos no están pagando la cuota,
Felipe Soto: sí,
fabian mendez ramos: les tiene que saltar operaciones que no lo pueden asignar.
Felipe Soto: sí. Y eso, eso es lo que venía pensando en la mañana cuando estábamos hablando ayer con los dos archivos seguros. es que debería haber como una sección específico de seguros dentro del este módulo de presa de transporte como sea como
fabian mendez ramos: Ya, como que sea
Felipe Soto: interdependiente, por decir algún modo, como a la vista que estás viendo acá para que quede más detallado,
fabian mendez ramos: Yeah.
Felipe Soto: quede más más específico, más ordenado, yo creo que porque si mezclamos como seguro y que esté todo consolidado en un mismo espacio de la empresa de transporte, ahí la huevada se va de nuevo. Vamos a tener como un un sistema eh sobrecargado mentalmente.


00:37:02

Felipe Soto: La persona que le da esa ha va a ser baja.
fabian mendez ramos: Sí, o sea, es lo que como que Pablo arregló como en operaciones porque lo viera más más
Felipe Soto: Hón.
fabian mendez ramos: rápido. Que pasa aquí lo mismo, que se meta solo al módulo como seguro y sea todo general por la empresa, ¿no? Que se meta, por ejemplo, aquí busque los documentos generales y va a tener que irse al a buscar dónde está seguro para saber si que pagó o no.
Felipe Soto: Sí, sí, de hecho seguro debería ser como un un un icono más aquí en el menú,
fabian mendez ramos: Ya.
Felipe Soto: creo pensamos como a nivel como uno,
fabian mendez ramos: Ok.
Felipe Soto: uno es a uno, eh, va a ser, oye, la empresa transporte tanto eh la y que entre esos dos módulos, su seguro, empresa transporte, conversence, como que si quieras ver el seguro información de seguro asociado a la empresa de transporte en particular, sea un dato dado en el módulo de empresa de transporte, ¿no? Sí, si quieres ver el detalle de el seguro para empresas de transporte en específicos, como que se invierte la revisión de la data. ¿Me cacháis?
fabian mendez ramos: Voy entendiendo menos el concepto que sería más fácil y más rápido para operaciones.


00:38:35

Felipe Soto: Sí.
fabian mendez ramos: que no debería estar metido como tan a fondo en ese caso. lo que visualicen el dato,
Felipe Soto: Sí, sí, ya hay pega,
fabian mendez ramos: ¿no?
Felipe Soto: hay harta pega. Que vemos si me queda claro con lo con lo que hicimos. Entonces, me conecto a cuál es el sharepoint del del que estáis centralizando con la estructura que yo les mandé para poder
fabian mendez ramos: Te lo mando, te lo mando de nuevo porque en buscarle los mensajes que
Felipe Soto: leerlo.
fabian mendez ramos: tenemos que te lo mandé alguna vez.
Felipe Soto: El archivo en base al al a la estructura que yo compartí,
fabian mendez ramos: Sí,
Felipe Soto: ¿cierto?
fabian mendez ramos: ahí se supone que yo actualice lo último y ahora me falta que tengo que agregar eh s por lo del archivo de seguros y
Felipe Soto: la fórmula.
fabian mendez ramos: este de que sacamos de la empresa para que
Felipe Soto: Perfecto.
fabian mendez ramos: por lo menos tire de info como seminueva. Ya después sabiendo que lo puede hacer el claudito ya tener como la general porque me tire toda la
Felipe Soto: Mhm. Ya no,
fabian mendez ramos: empresa
Felipe Soto: ya no es, ya no es Claudito ni Claudio, es Claudote.


00:40:05

Felipe Soto: Se está poniendo bueno.
fabian mendez ramos: porque más encima el hón te dice así como me mandó Pablo hasta lo que preguntaba.
Felipe Soto: Sí. Hón, ¿por qué se le ocurre a él y no a mí?
fabian mendez ramos: Me sí le Pablo me mandó como los pantallazos y cuando reiteró primero me pone la pregunta decía,
Felipe Soto: Hij
fabian mendez ramos: ¿qué alcance proceso en esta primera pasada? y le pone opción uno, solo empresa activa, tracto más furgones más, solo carpetas que empiezan con transporte todos los 296 por lotes var iteraciones. Te confirmo la carpeta exacta primero. Otra cosa, como la pregunta,
Felipe Soto: Ya, ya, pues, ¿qué vamos a hacer entonces? Aló,
fabian mendez ramos: así que ahí mañana me pongo Se te fue el
Felipe Soto: ¿me escucháis? Ah, ya. No,
fabian mendez ramos: audio,
Felipe Soto: es que como que quedó como que quedó un silencio así como que se corta. Pensé que había quedado pegado.
fabian mendez ramos: ¿no? Y ahí yo mañana me meto a actualizar el archivo para llegar
Felipe Soto: Ya,
fabian mendez ramos: esta info y ahí dejarlo un poco más
Felipe Soto: perfecto.
fabian mendez ramos: avanzado.
Felipe Soto: Ya hablamos entonces. Gracias por tu tiempo.
fabian mendez ramos: Ya, Pipe,
Felipe Soto: Hablamos. Ciao.
fabian mendez ramos: estamos hablando.
Felipe Soto: Ciao.


La transcripción finalizó después de 00:41:49

Esta transcripción editable se generó por computadora y puede contener errores. Los usuarios también pueden cambiar el texto después de que se cree.

