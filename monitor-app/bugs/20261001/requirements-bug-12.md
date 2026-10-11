### **Requerimiento Funcional: Corrección de Filtrado de Vehículos y Persistencia de Datos en Cierre Diario (TMS - Walmart)**

---

#### **1. Contexto y Problema**

Durante el proceso de cierre diario en la plataforma TM de Walmart, la operación enfrenta bloqueos recurrentes debido a dos fallas principales de integración y gestión de datos desde el TMS:

1. **Entrada de vehículos no operativos:** Se reciben patentes clasificadas como "otro transporte" (previamente registradas como vehículos de carga). Al llegar al TM de Walmart sin una empresa asignada, bloquean el flujo de cierre.
2. **Falta de persistencia en reasignaciones:** Los cambios manuales de empresa realizados sobre conductores y tractos se revierten al día siguiente tras las sincronizaciones automáticas, obligando al usuario a realizar la reconfiguración manualmente de forma diaria.

---

#### **2. Alcance del Requerimiento**

##### **RF-01: Validacion y Filtrado de Tipo de Transporte (TMS -> Walmart TM)**

* **Descripción:** Restringir el ingreso de vehículos al proceso de cierre que no correspondan a la categoría de carga activa.
* **Comportamiento esperado:**
* El sistema debe validar el tipo de transporte antes de poblar la bandeja de cierre en el TM de Walmart.
* Si la patente corresponde a "otro transporte" o no cuenta con una empresa asociada, debe excluirse automáticamente del flujo de cierre operativo o enviarse a un estado no vinculante que no impida la ejecución del cierre.



##### **RF-02: Persistencia y Control de Sobrescritura en Reasignaciones (Conductores y Tractos)**

* **Descripción:** Garantizar que las modificaciones de empresa asignada a conductores y tractos sean permanentes y no se pierdan con las actualizaciones de datos entrantes.
* **Comportamiento esperado:**
* Al guardar una reasignación manual de empresa para un conductor o tracto, el sistema debe registrar el cambio con prioridad de persistencia.
* La interfaz o tarea de sincronización nocturna/diaria del TMS no debe sobrescribir los campos de empresa si el registro fue actualizado manualmente en el sistema local, a menos que provenga de una actualización explícita de origen validada.



---

#### **3. Criterios de Aceptación**

| ID | Escenario | Resultado Esperado |
| --- | --- | --- |
| **CA-01** | Recepción de patente tipo "Otro Transporte" | La patente no aparece en la bandeja de cierre del TM de Walmart ni genera bloqueos por falta de empresa asignada. |
| **CA-02** | Reasignación manual de Conductor/Tracto | La empresa asignada se mantiene guardada tras el cierre del día y permanece intacta en los días posteriores. |
| **CA-03** | Ejecución de Sincronización Automática | El proceso batch/API no revierte los datos de conductores y tractos ajustados el día anterior. |
