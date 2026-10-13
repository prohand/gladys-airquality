# Calidad del aire

Siga en Gladys el índice de calidad del aire de los lugares que elija, con un
dispositivo por lugar. Puede añadir sus **viviendas de Gladys con un clic**, o un lugar
escribiendo el nombre de su **ciudad**, **en cualquier parte del mundo**.

Sin cuenta que crear ni clave de API que pegar: las dos fuentes que usa esta
integración son abiertas y públicas.

## Añadir sus viviendas de Gladys con un clic

Ya le ha dicho a Gladys dónde vive: es el mapa de **Configuración > Viviendas**.
El botón **«Añadir mis viviendas de Gladys»** lee esas viviendas y crea un lugar
por cada una que aún no se vigila, sin escribir ninguna ciudad.

Tres cosas que conviene saber:

- **El acceso es un permiso.** Dónde vive es un dato personal: Gladys solo lo
  comparte si aceptó la solicitud en la pantalla de instalación de la
  integración. Si el botón responde que el acceso está denegado, elimine la
  integración y vuelva a instalarla, aceptando la solicitud que muestra.
- **Una vivienda que nunca colocó en el mapa no tiene coordenadas.** Se nombra
  en la respuesta; ubíquela en Configuración > Viviendas y vuelva a ejecutar la
  acción.
- **No es una sincronización.** Las viviendas se leen en el momento en que pulsa.
  Lo que sale es un lugar normal, que se renombra y elimina como los demás, y
  una vivienda que se mueva después en Gladys no mueve su lugar.

Para añadir solo una de sus viviendas (una segunda residencia que no quiere
vigilar se queda fuera), elíjala en el campo **Vivienda** del botón; si lo deja
vacío, se añaden todas las viviendas.

Pulsar de nuevo no supone ningún riesgo: una vivienda ya vigilada se indica, no
se añade una segunda vez. Un lugar que procede de una vivienda no tiene
etiqueta de dirección: la lista muestra su nombre y su punto, porque el
geocodificador no puede nombrar la ciudad en la que se encuentra un punto.

## Añadir un lugar

1. Abra la pestaña **Configuración** de la integración.
2. En la sección «Sus lugares», pulse **Añadir un lugar**.
3. Escriba la **ciudad** («Nantes», «Montreal», «Kioto») y, opcionalmente, un
   **nombre** para este lugar («Casa», «Oficina»…). Sin nombre, el lugar toma el
   nombre del sitio encontrado.
4. La respuesta aparece bajo el botón. Si todo va bien, confirma que se ha
   añadido y le da el número del lugar.
5. Vaya a la pestaña **Descubrir**: el dispositivo «Qualité de l'air — _su
   lugar_» («Calidad del aire — _su lugar_» si el idioma de los nombres de
   dispositivo es el español) le espera allí. Pulse **Añadir a Gladys** para crearlo.

### Un nombre, varios lugares

La mayoría de los nombres de ciudad están repetidos: solo en Francia hay varios
Montauban, un París en Texas y un Springfield por estado de EE. UU. Cuando eso
ocurre, la integración no elige por usted: responde con la lista de lugares
encontrados y le pide que precise.

Precise **tras una coma**: la región, el departamento, el estado, el país o el
código postal, en cualquier orden.

- «Montauban, Tarn-et-Garonne»
- «Springfield, Illinois»
- «Nantes, 44000»
- «Paris, France»

Las tildes y las mayúsculas no importan: «saint-etienne» encuentra
«Saint-Étienne».

### O directamente un punto

Si el geocodificador no conoce su aldea, o si quiere un punto preciso tomado de
un mapa, indique en su lugar la **latitud** y la **longitud** (grados decimales
WGS-84). Las dos van juntas: una sola no es un punto. Entonces tienen prioridad
sobre la ciudad escrita, que solo se conserva como etiqueta.

## Listar sus lugares

El botón **Mostrar mis lugares** lista todo lo que vigila la integración:
número, nombre, ubicación (ciudad, región, país) y coordenadas. Una entrada por
línea, cada una empieza por «•».

Esos **números son los que usa la eliminación**: ejecute esta acción antes de
eliminar un lugar para estar seguro del número.

## Eliminar un lugar

1. Pulse **Eliminar un lugar**.
2. Elija el **número** del lugar en la lista desplegable.
3. Ejecute la acción una vez **sin marcar** la casilla: la respuesta le dice qué
   lugar se eliminaría. Compruebe que es el correcto.
4. Marque **Confirmo la eliminación** y vuelva a ejecutarla.

El lugar desaparece de inmediato de la pestaña «Descubrir».

> **El dispositivo de Gladys en sí no se elimina.** Una integración no puede
> eliminar un dispositivo que usted creó: solo puede dejar de ofrecerlo. Si
> había añadido el dispositivo de este lugar, la respuesta lo nombra: elimínelo
> usted mismo desde la pestaña **Dispositivos** de la integración; si no, se
> queda ahí y no vuelve a actualizarse.

Tenga en cuenta también la renumeración: eliminar el lugar 2 de cuatro convierte
los lugares 3 y 4 en los lugares 2 y 3. Vuelva a ejecutar «Mostrar mis lugares»
antes de eliminar otro.

## Qué mide el dispositivo

Cada dispositivo expone:

| Función                                     | Qué contiene                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Índice de calidad del aire**              | de 1 a 6: el que debe usar en una escena                                                          |
| **Calidad del aire (texto)**                | Buena, Razonablemente buena, Regular, Desfavorable, Muy desfavorable, Extremadamente desfavorable |
| **Contaminante dominante**                  | el contaminante que ha fijado el índice                                                           |
| **Subíndice PM2,5 / PM10 / NO₂ / O₃ / SO₂** | de 1 a 6, contaminante por contaminante                                                           |
| **PM2,5 / PM10 / NO₂ / O₃ / SO₂**           | la concentración, en µg/m³                                                                        |
| **Última actualización de los datos**       | la hora de los datos, en la hora local del lugar                                                  |

Las seis clases del índice:

| Índice | Calidad del aire            |
| ------ | --------------------------- |
| 1      | Buena                       |
| 2      | Razonablemente buena        |
| 3      | Regular                     |
| 4      | Desfavorable                |
| 5      | Muy desfavorable            |
| 6      | Extremadamente desfavorable |

El índice global es el del **peor contaminante**: así se definen tanto el índice
europeo como el índice francés ATMO. Basta con que un contaminante empeore para
que empeore el aire.

Junto a su subíndice, cada contaminante recibe también su **concentración bruta
en µg/m³**: un subíndice es una franja, y una franja oculta lo que ocurre dentro
de ella; una tarde de ozono que sube de 55 a 128 µg/m³ nunca sale de la clase 3.
Cada uno de los cinco tiene su propia categoría de sensor en Gladys, así que
todos tienen su icono, su insignia de color y su curva en el historial.

La **última actualización de los datos** es la hora del análisis CAMS para ese
lugar, no la hora en que se ejecutó la integración por última vez: el modelo se
calcula cada hora, así que actualizar más a menudo no la cambia. Se muestra en
la **hora local del lugar** (seguida de su zona, `CEST`, `GMT+9`…), por eso cada
dispositivo tiene la suya: dos lugares pueden mostrar, con razón, dos horas
distintas.

Un contaminante para el que la fuente **no tiene valor** no publica nada en
absoluto. Una medición que falta no es aire limpio: escribir 1 falsearía el
historial y podría activar una escena de «el aire vuelve a ser bueno».

## De dónde vienen los datos

**Las concentraciones** proceden de los datos **CAMS** (Copernicus Atmosphere
Monitoring Service, el servicio de atmósfera de la Unión Europea, gestionado por
el ECMWF), redistribuidos como datos abiertos por
[Open-Meteo](https://open-meteo.com/en/docs/air-quality-api). Dos modelos, y la
integración elige según dónde esté el lugar:

| Dónde está el lugar     | Modelo leído | Resolución |
| ----------------------- | ------------ | ---------- |
| En Europa               | CAMS europeo | ~11 km     |
| En cualquier otro sitio | CAMS global  | ~40 km     |

Ambos publican los mismos cinco contaminantes regulados. Un lugar se queda
siempre en el mismo modelo, así que su historial es una única serie y no dos
conjuntos de datos apilados bajo un mismo gráfico.

[Atmo France](https://www.atmo-france.org/) es la referencia del índice francés
ATMO, pero su API exige una cuenta y un token de autenticación que cada usuario
tendría que crear antes de que la integración funcionara. Se ha preferido una
fuente oficial, abierta y sin autenticación.

**El índice** se calcula a partir de esas concentraciones con los umbrales del
**Índice Europeo de Calidad del Aire** (Agencia Europea de Medio Ambiente). Son,
franja por franja, los del **índice ATMO** francés desde el _arrêté du 10
juillet 2020_, en vigor desde el 1 de enero de 2021, que alineó el índice
nacional con el europeo: seis clases, los mismos cinco contaminantes regulados,
los mismos límites.

Una diferencia que conviene conocer: el índice ATMO publicado es **diario**
(media del día para las partículas, máximo diario para los gases), mientras que
esta integración lee la **hora actual**, como hace el índice europeo. Por eso el
valor reacciona en menos de una hora, que es lo que necesita una escena de
domótica, en lugar de reproducir el boletín ATMO del día.

**Las ciudades** se convierten en coordenadas con la
[API de geocodificación de Open-Meteo](https://open-meteo.com/en/docs/geocoding-api),
basada en la base de datos mundial **GeoNames**. También abierta, también sin
cuenta y sin clave de API.

## En su panel

Se ofrecen dos widgets en **Panel → Editar → Nuevo widget**, en
**Widgets de integraciones**. Siguen el idioma de quien los mira, y sus colores siguen el tema
de Gladys (claro u oscuro).

### Calidad del aire — un lugar

La tarjeta de un lugar, elegido entre los dispositivos ya añadidos desde la
pestaña «Descubrir»:

- un **indicador** de 1 a 6 con el índice actual;
- el **contaminante dominante**, el que fija el índice (nada cuando el aire es
  bueno);
- una fila por contaminante, el peor primero, con su clase **y** su
  concentración: «4/6 (Desfavorable) · 150 µg/m³»;
- la **curva de las próximas horas**, hoy y mañana: lo único que ningún sensor
  puede mostrar, porque aún no ha ocurrido;
- la hora del análisis CAMS y un botón **Actualizar**.

Dos ajustes por tarjeta:

- **Contaminantes seguidos**: marque los que le interesan (ozono en verano,
  partículas en invierno); el indicador, las filas y la curva solo tienen en
  cuenta esos. Ninguno marcado = todos, que es el índice que publica Gladys.
- **Mostrar las próximas horas**: desmárquelo para una tarjeta compacta.

### Calidad del aire — mis lugares

Una fila por lugar configurado, con su índice y su contaminante dominante, y un
botón **Actualizar** que vuelve a leer todos los lugares. Sin ajustes: la tarjeta
muestra la lista gestionada en la configuración. A partir de diez lugares, el
pie de la tarjeta indica cuántos quedan fuera.

Los colores: verde para «Buena» y «Razonablemente buena», amarillo para
«Regular», rojo de «Desfavorable» a «Extremadamente desfavorable». La paleta de
los widgets no tiene ni naranja ni morado; repetir un rojo es mejor que pintar
de amarillo un «Desfavorable».

## Usar el índice en una escena

### 1. Las medidas, como cualquier sensor

El índice, los subíndices y las concentraciones son funciones del dispositivo:
el activador de Gladys «Cambio de estado del dispositivo» las vigila como a
cualquier sensor («cuando el índice supere 3»).

### 2. Los activadores

En el editor de escenas, en la categoría **Integraciones** del selector de
activadores (cada entrada muestra «Calidad del aire» bajo su nombre):

- **El índice de calidad del aire ha cambiado**: una vez, cuando el índice
  global de un lugar **pasa** de una clase a otra. Nunca en cada actualización.
- **El subíndice de un contaminante ha cambiado**: lo mismo, contaminante por
  contaminante.

Cada activador se puede filtrar (todo es opcional; un filtro vacío significa
«cualquiera»): el **lugar**, la(s) **nueva(s) clase(s)**, el **sentido**
(«Empeora» para cerrar las ventanas, «Mejora» para volver a abrirlas) y, en el
segundo, el/los **contaminante(s)**.

La escena recibe variables listas para usar, entre ellas
`{{triggerEvent.data.summary}}`: «Calidad del aire en Casa: índice 4/6
(Desfavorable), dominante Ozono (O₃).», para usar tal cual en una notificación.
Las demás: nombre del lugar, clase nueva y anterior (en número y en palabras),
sentido, contaminante, concentración (segundo activador), hora del análisis.

Dos cosas que conviene saber:

- **No se activa nada en la primera lectura** tras un arranque: la clase
  anterior es desconocida, y «desconocida → 4» no es un cambio.
- **Los datos que faltan no son una vuelta al aire bueno**: no activan nada, y
  la siguiente clase se compara con la última que se leyó realmente.

### 3. Las acciones

- **Leer la calidad del aire**: lee un lugar ahora y pasa a las siguientes
  acciones la clase, su etiqueta, el contaminante, su concentración, la hora del
  análisis y la misma frase lista. Elija «Índice global» (el peor contaminante
  del momento) o un contaminante. ¿No hay datos? La clase queda vacía y la frase
  lo dice: compruébelo en una condición en lugar de esperar un error.
- **Actualizar los datos de calidad del aire**: vuelve a leer y republica un
  lugar, o todos si deja el lugar vacío, sin esperar a la próxima
  actualización. Devuelve cuántos lugares se han actualizado y cuántos han
  fallado.

Ejemplo: «todos los días a las 7 → Leer la calidad del aire (Casa) → enviarme
`{{summary}}`».

## Ajustes

- **Idioma de los nombres de dispositivo**: francés por defecto (también inglés,
  alemán y español). Todo lo que muestra la integración ya sigue el idioma de su
  cuenta de Gladys, pero el nombre de un dispositivo y de sus funciones se guarda
  tal como se publica, así que hay que elegirlo aquí. Un dispositivo ya añadido
  conserva los nombres con los que se creó; elimínelo y vuelva a añadirlo desde
  la pestaña «Descubrir» para renombrarlo. Este ajuste es también el idioma en
  el que responde el geocodificador: «Munich» o «München» para la misma ciudad.
- **Intervalo de actualización**: 1 hora por defecto (entre 15 minutos y 24
  horas). El análisis CAMS se genera una vez por hora: bajar de ahí no aporta
  nada.

## Comprobar que funciona

El botón **Probar la fuente de calidad del aire** consulta la fuente en directo
para **cada** lugar y muestra el índice de cada uno, con el mismo formato que la
lista. Es la forma más rápida de ver si un lugar tiene un problema, y por qué.

La pestaña **Supervisión** muestra el estado de la integración a nivel de
aplicación: se pone en rojo, con el motivo, cuando un lugar ya no se puede leer.

Un lugar para el que la fuente no responde **se vuelve a intentar por separado**,
30 segundos después y luego 2 minutos después (más si la fuente pide ir más
despacio), en lugar de quedarse vacío hasta la próxima actualización. Todos sus
lugares se leen juntos, con una petición por modelo CAMS.

## Límites

- **El índice es el europeo, aplicado en todas partes.** Fuera de Europa no es,
  por tanto, el índice nacional del país: un lugar en Estados Unidos, China o la
  India se califica con las franjas europeas, no con el AQI estadounidense, el
  índice chino ni el CAQI indio. Las concentraciones, en cambio, siguen siendo
  las concentraciones.
- Fuera de Europa el modelo es **cuatro veces más grueso** (~40 km frente a ~11
  km): describe bien un fondo regional, una calle no tanto.
- Veinte lugares como máximo.
- Gladys **5.2.0** o posterior: la 5.1.0 abrió los widgets y las escenas a las
  integraciones, la 5.2.0 el selector de viviendas de «Añadir mis viviendas de
  Gladys».
- Un lugar no se puede editar: para vigilar otro municipio, elimínelo y añada
  uno nuevo.
