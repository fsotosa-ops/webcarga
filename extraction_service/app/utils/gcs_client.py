from google.cloud import storage
import logging

logger = logging.getLogger(__name__)

def upload_file_to_gcs(local_file_path: str, bucket_name: str, destination_blob_name: str) -> str:
    try:
        storage_client = storage.Client()
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(destination_blob_name)
        
        blob.upload_from_filename(local_file_path)
        logger.info(f"Archivo {local_file_path} subido a gs://{bucket_name}/{destination_blob_name}")
        return f"gs://{bucket_name}/{destination_blob_name}"
    except Exception as e:
        logger.error(f"Error al subir archivo a GCS: {str(e)}")
        raise
